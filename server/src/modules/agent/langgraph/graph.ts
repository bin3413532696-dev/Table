import { StateGraph, END, Command, interrupt } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { AgentState, ToolCall, ExecutedToolCall, TimelineEvent } from './state';
import { AgentStateAnnotation, MAX_ITERATIONS } from './state';
import { createChatModel } from './chatModel';
import { parseToolCalls, getCachedResult, setCachedResult } from './parser';
import { SYSTEM_PROMPT, buildToolResultPrompt } from './prompts';
import { allTools, requiresConfirmation } from './tools';
import { getCheckpointer } from './postgres-checkpointer';
import { MessageManager } from './message-manager';

function now() {
  return Date.now();
}

function isoNow() {
  return new Date().toISOString();
}

const LLM_TIMEOUT_MS = Number(process.env.AGENT_LLM_TIMEOUT_MS) || 30000;

function appendTimeline(state: AgentState, event: TimelineEvent): TimelineEvent[] {
  return [...state.timeline, event];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function executeToolCallInternal(toolCall: ToolCall): Promise<ExecutedToolCall> {
  const tool = allTools.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      ...toolCall,
      result: null,
      success: false,
      error: `不支持的工具: ${toolCall.name}`,
      status: 'failed',
      createdAt: now(),
    };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as any).invoke(toolCall.arguments);
    return {
      ...toolCall,
      result,
      success: true,
      status: 'completed',
      createdAt: now(),
    };
  } catch (error) {
    return {
      ...toolCall,
      result: null,
      success: false,
      error: error instanceof Error ? error.message : '工具执行失败',
      status: 'failed',
      createdAt: now(),
    };
  }
}

async function initNode(): Promise<Partial<AgentState>> {
  return {
    messages: [],
    executedToolCalls: [],
    pendingToolCalls: [],
    iterationCount: 0,
    status: 'running',
    requiresConfirmation: false,
    pendingToolExecution: null,
    confirmedToolCall: null,
    error: null,
    assistantTextChunks: [],
    timeline: [],
    finalText: '',
  };
}

async function buildMessagesNode(state: AgentState): Promise<Partial<AgentState>> {
  const timestamp = now();
  const messages: AgentState['messages'] = [
    { role: 'system', content: state.systemPrompt || SYSTEM_PROMPT, createdAt: timestamp },
    ...state.initialMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
        createdAt: timestamp,
      })),
    { role: 'user', content: state.inputText, createdAt: timestamp },
  ];

  if (state.executedToolCalls.length > 0) {
    messages.push({
      role: 'user',
      content: buildToolResultPrompt(state.executedToolCalls),
      createdAt: timestamp,
    });
  }

  return { messages };
}

async function callModelNode(state: AgentState): Promise<Partial<AgentState>> {
  const chatModel = createChatModel(state.provider, state.model);
  let lcMessages = state.messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  const messageManager = MessageManager.fromProviderConfig(state.provider, state.model);
  lcMessages = (await messageManager.trim(lcMessages)) as typeof lcMessages;

  const startTs = isoNow();
  const response = await withTimeout(
    chatModel.invoke(lcMessages),
    LLM_TIMEOUT_MS,
    `LLM request (${state.model})`
  );
  const responseContent =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  return {
    messages: [
      ...state.messages,
      { role: 'assistant', content: responseContent, createdAt: now() },
    ],
    assistantTextChunks: [...state.assistantTextChunks, responseContent],
    timeline: appendTimeline(state, {
      type: 'llm_start',
      timestamp: startTs,
      data: { model: state.model },
    }).concat({
      type: 'llm_end',
      timestamp: isoNow(),
      data: { model: state.model },
    }),
  };
}

async function parseToolsNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant') {
    return { pendingToolCalls: [] };
  }

  const { textContent, toolCalls } = parseToolCalls(lastMessage.content);
  return {
    pendingToolCalls: toolCalls,
    messages: [
      ...state.messages.slice(0, -1),
      {
        ...lastMessage,
        content: textContent,
      },
    ],
  };
}

async function checkConfirmationNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.confirmedToolCall) {
    return { requiresConfirmation: false };
  }

  for (const toolCall of state.pendingToolCalls) {
    if (requiresConfirmation(toolCall.name)) {
      return {
        requiresConfirmation: true,
        status: 'waiting_confirmation',
        pendingToolExecution: {
          id: toolCall.id,
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          confirmationMessage: `即将执行 ${toolCall.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`,
        },
      };
    }
  }

  return { requiresConfirmation: false };
}

async function executeToolsNode(state: AgentState): Promise<Partial<AgentState>> {
  const accumulated = [...state.executedToolCalls];
  const pendingConfirmTools: ToolCall[] = [];
  let nextStatus: AgentState['status'] | undefined;
  let nextError: string | null | undefined;
  let timeline = [...state.timeline];

  for (const toolCall of state.pendingToolCalls) {
    if (requiresConfirmation(toolCall.name)) {
      pendingConfirmTools.push(toolCall);
      continue;
    }

    const startTs = isoNow();
    timeline.push({
      type: 'tool_start',
      timestamp: startTs,
      data: { toolName: toolCall.name, arguments: toolCall.arguments },
    });

    const cached = getCachedResult(toolCall.name, toolCall.arguments);
    if (cached !== null) {
      accumulated.push({
        ...toolCall,
        result: cached,
        success: true,
        status: 'completed',
        createdAt: now(),
      });
      timeline.push({
        type: 'tool_end',
        timestamp: isoNow(),
        data: { toolName: toolCall.name, success: true, cached: true },
      });
      continue;
    }

    const executed = await executeToolCallInternal(toolCall);
    if (executed.success) {
      setCachedResult(toolCall.name, toolCall.arguments, executed.result);
    } else if (!nextError) {
      nextStatus = 'failed';
      nextError = executed.error ?? '工具执行失败';
    }
    accumulated.push(executed);
    timeline.push({
      type: 'tool_end',
      timestamp: isoNow(),
      data: { toolName: toolCall.name, success: executed.success },
    });
  }

  return {
    executedToolCalls: accumulated,
    pendingToolCalls: pendingConfirmTools,
    iterationCount: state.iterationCount + 1,
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(nextError !== undefined ? { error: nextError } : {}),
    timeline,
  };
}

async function requestConfirmationNode(state: AgentState): Promise<Partial<AgentState> | Command> {
  if (!state.pendingToolExecution) {
    return { status: 'completed' };
  }

  const approved = interrupt<{
    toolName: string;
    arguments: Record<string, unknown>;
    confirmationMessage: string;
  }, boolean>({
    toolName: state.pendingToolExecution.toolName,
    arguments: state.pendingToolExecution.arguments,
    confirmationMessage: state.pendingToolExecution.confirmationMessage,
  });

  if (!approved) {
    return {
      status: 'cancelled',
      requiresConfirmation: false,
      pendingToolExecution: null,
      pendingToolCalls: [],
      timeline: appendTimeline(state, {
        type: 'interrupted',
        timestamp: isoNow(),
        data: { reason: 'rejected', toolName: state.pendingToolExecution.toolName },
      }),
    };
  }

  return new Command({
    goto: 'execute_confirmed_tool',
    update: {
      confirmedToolCall: {
        id: state.pendingToolExecution.id,
        name: state.pendingToolExecution.toolName,
        arguments: state.pendingToolExecution.arguments,
      },
      requiresConfirmation: false,
      status: 'running',
      timeline: appendTimeline(state, {
        type: 'confirmation',
        timestamp: isoNow(),
        data: {
          toolName: state.pendingToolExecution.toolName,
          arguments: state.pendingToolExecution.arguments,
        },
      }),
    },
  });
}

async function executeConfirmedToolNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.confirmedToolCall) {
    return {};
  }

  const toolCall = state.confirmedToolCall;
  const timeline = appendTimeline(state, {
    type: 'tool_start',
    timestamp: isoNow(),
    data: { toolName: toolCall.name, arguments: toolCall.arguments, confirmed: true },
  });

  const cached = getCachedResult(toolCall.name, toolCall.arguments);
  let executed: ExecutedToolCall;
  if (cached !== null) {
    executed = {
      ...toolCall,
      result: cached,
      success: true,
      status: 'completed',
      createdAt: now(),
    };
  } else {
    executed = await executeToolCallInternal(toolCall);
    if (executed.success) {
      setCachedResult(toolCall.name, toolCall.arguments, executed.result);
    }
  }

  return {
    executedToolCalls: [...state.executedToolCalls, executed],
    confirmedToolCall: null,
    pendingToolExecution: null,
    pendingToolCalls: [],
    ...(executed.error ? { error: executed.error, status: 'failed' as const } : {}),
    timeline: timeline.concat({
      type: 'tool_end',
      timestamp: isoNow(),
      data: { toolName: toolCall.name, success: executed.success, confirmed: true },
    }),
  };
}

async function finalizeNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastAssistant = [...state.messages].reverse().find((m) => m.role === 'assistant');
  return {
    finalText: lastAssistant?.content || '',
    status: state.status === 'cancelled' ? 'cancelled' : state.error ? 'failed' : 'completed',
  };
}

function afterParseRouter(state: AgentState): string {
  if (state.status === 'cancelled' || state.status === 'failed') return 'finalize';
  if (state.iterationCount >= MAX_ITERATIONS) return 'finalize';
  if (state.pendingToolCalls.length === 0) return 'finalize';
  return 'check_confirmation';
}

function afterCheckConfirmationRouter(state: AgentState): string {
  if (state.requiresConfirmation) return 'request_confirmation';
  if (state.pendingToolCalls.length > 0) return 'execute_tools';
  return 'finalize';
}

function afterExecuteRouter(state: AgentState): string {
  if (state.status === 'cancelled' || state.status === 'failed') return 'finalize';
  if (state.iterationCount >= MAX_ITERATIONS) return 'finalize';
  return 'build_messages';
}

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode('init', initNode)
  .addNode('build_messages', buildMessagesNode)
  .addNode('call_model', callModelNode)
  .addNode('parse_tools', parseToolsNode)
  .addNode('check_confirmation', checkConfirmationNode)
  .addNode('execute_tools', executeToolsNode)
  .addNode('request_confirmation', requestConfirmationNode, {
    ends: ['execute_confirmed_tool'],
  })
  .addNode('execute_confirmed_tool', executeConfirmedToolNode)
  .addNode('finalize', finalizeNode)
  .addEdge('__start__', 'init')
  .addEdge('init', 'build_messages')
  .addEdge('build_messages', 'call_model')
  .addEdge('call_model', 'parse_tools')
  .addConditionalEdges('parse_tools', afterParseRouter)
  .addConditionalEdges('check_confirmation', afterCheckConfirmationRouter)
  .addConditionalEdges('execute_tools', afterExecuteRouter)
  .addConditionalEdges('execute_confirmed_tool', afterExecuteRouter)
  .addEdge('finalize', END);

export const agentGraph = workflow.compile({
  checkpointer: getCheckpointer(),
});

export type AgentGraphStreamChunk =
  | { mode: 'values'; data: AgentState }
  | { mode: 'messages'; data: unknown }
  | { mode: 'tasks'; data: unknown };

async function resolveFinalState(runId: string, fallback?: AgentState): Promise<AgentState> {
  const snapshot = await agentGraph.getState({
    configurable: { thread_id: runId },
  });

  if (snapshot?.values) {
    return snapshot.values as AgentState;
  }

  if (fallback) {
    return fallback;
  }

  throw new Error(`Missing checkpoint state for run ${runId}`);
}

export async function executeAgentGraph(input: {
  inputText: string;
  initialMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  provider: AgentState['provider'];
  model: string;
  runId: string;
  userId: string;
  systemPrompt?: string;
}): Promise<AgentState> {
  const initialState: Partial<AgentState> = {
    inputText: input.inputText,
    initialMessages: input.initialMessages,
    provider: input.provider,
    model: input.model,
    runId: input.runId,
    userId: input.userId,
    systemPrompt: input.systemPrompt || SYSTEM_PROMPT,
  };

  return agentGraph.invoke(initialState, {
    configurable: { thread_id: input.runId },
  });
}

export async function streamAgentGraph(input: {
  inputText: string;
  initialMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  provider: AgentState['provider'];
  model: string;
  runId: string;
  userId: string;
  systemPrompt?: string;
  onChunk: (chunk: AgentGraphStreamChunk) => Promise<void> | void;
}): Promise<AgentState> {
  const initialState: Partial<AgentState> = {
    inputText: input.inputText,
    initialMessages: input.initialMessages,
    provider: input.provider,
    model: input.model,
    runId: input.runId,
    userId: input.userId,
    systemPrompt: input.systemPrompt || SYSTEM_PROMPT,
  };

  const stream = await agentGraph.stream(initialState, {
    configurable: { thread_id: input.runId },
    streamMode: ['values', 'tasks'],
  });

  let lastValues: AgentState | undefined;

  for await (const chunk of stream) {
    if (!Array.isArray(chunk) || chunk.length < 2) {
      continue;
    }

    const [mode, data] = chunk as [string, unknown];
    if (mode !== 'values' && mode !== 'tasks') {
      continue;
    }

    if (mode === 'values') {
      lastValues = data as AgentState;
    }

    await input.onChunk({ mode, data } as AgentGraphStreamChunk);
  }

  return resolveFinalState(input.runId, lastValues);
}

export async function continueAgentGraph(runId: string, approved: boolean): Promise<AgentState> {
  return agentGraph.invoke(new Command({ resume: approved }), {
    configurable: { thread_id: runId },
  });
}

export async function streamContinueAgentGraph(input: {
  runId: string;
  approved: boolean;
  onChunk: (chunk: AgentGraphStreamChunk) => Promise<void> | void;
}): Promise<AgentState> {
  const stream = await agentGraph.stream(new Command({ resume: input.approved }), {
    configurable: { thread_id: input.runId },
    streamMode: ['values', 'tasks'],
  });

  let lastValues: AgentState | undefined;

  for await (const chunk of stream) {
    if (!Array.isArray(chunk) || chunk.length < 2) {
      continue;
    }

    const [mode, data] = chunk as [string, unknown];
    if (mode !== 'values' && mode !== 'tasks') {
      continue;
    }

    if (mode === 'values') {
      lastValues = data as AgentState;
    }

    await input.onChunk({ mode, data } as AgentGraphStreamChunk);
  }

  return resolveFinalState(input.runId, lastValues);
}
