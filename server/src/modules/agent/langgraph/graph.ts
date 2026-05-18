import { StateGraph, END, interrupt } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { AgentState, ToolCall, ExecutedToolCall } from './state';
import { AgentStateAnnotation, MAX_ITERATIONS } from './state';
import { createChatModel } from './chatModel';
import { parseToolCalls, getCachedResult, setCachedResult } from './parser';
import { SYSTEM_PROMPT, buildToolResultPrompt } from './prompts';
import { allTools, requiresConfirmation } from './tools';

/**
 * 执行单个工具
 */
async function executeToolCallInternal(toolCall: ToolCall): Promise<ExecutedToolCall> {
  const tool = allTools.find(t => t.name === toolCall.name);
  if (!tool) {
    return { ...toolCall, result: null, success: false, error: `不支持的工具: ${toolCall.name}` };
  }

  try {
    // LangChain tool.invoke 需要特定类型的参数，但我们动态执行需要绕过类型检查
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as any).invoke(toolCall.arguments);
    return { ...toolCall, result, success: true };
  } catch (error) {
    return {
      ...toolCall,
      result: null,
      success: false,
      error: error instanceof Error ? error.message : '工具执行失败',
    };
  }
}

/**
 * LangGraph Agent 执行图
 */

// ============ 节点函数 ============

/**
 * 初始化节点
 */
async function initNode(state: AgentState): Promise<Partial<AgentState>> {
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
  };
}

/**
 * 构建消息节点
 */
async function buildMessagesNode(state: AgentState): Promise<Partial<AgentState>> {
  const messages: AgentState['messages'] = [
    { role: 'system' as const, content: state.systemPrompt || SYSTEM_PROMPT },
    ...state.initialMessages
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
    { role: 'user' as const, content: state.inputText },
  ];

  // 如果有已执行的工具结果，添加工具结果消息
  if (state.executedToolCalls.length > 0) {
    messages.push({
      role: 'user' as const,
      content: buildToolResultPrompt(state.executedToolCalls),
    });
  }

  return { messages };
}

/**
 * 调用模型节点
 */
async function callModelNode(state: AgentState): Promise<Partial<AgentState>> {
  const chatModel = createChatModel(state.provider, state.model);

  const lcMessages = state.messages.map(m => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  const response = await chatModel.invoke(lcMessages);
  const responseContent = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);

  return {
    messages: [...state.messages, { role: 'assistant' as const, content: responseContent }],
  };
}

/**
 * 解析工具节点
 */
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
      { role: 'assistant' as const, content: textContent },
    ],
  };
}

/**
 * 检查确认节点
 */
async function checkConfirmationNode(state: AgentState): Promise<Partial<AgentState>> {
  if (state.confirmedToolCall) {
    return { requiresConfirmation: false };
  }

  for (const toolCall of state.pendingToolCalls) {
    if (requiresConfirmation(toolCall.name)) {
      return {
        requiresConfirmation: true,
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

/**
 * 执行工具节点
 */
async function executeToolsNode(state: AgentState): Promise<Partial<AgentState>> {
  const results: ExecutedToolCall[] = [];
  const pendingConfirmTools: ToolCall[] = [];

  for (const toolCall of state.pendingToolCalls) {
    if (requiresConfirmation(toolCall.name)) {
      pendingConfirmTools.push(toolCall);
      continue;
    }

    const cached = getCachedResult(toolCall.name, toolCall.arguments);
    if (cached !== null) {
      results.push({ ...toolCall, result: cached, success: true });
      continue;
    }

    const executed = await executeToolCallInternal(toolCall);
    if (executed.success) {
      setCachedResult(toolCall.name, toolCall.arguments, executed.result);
    }
    results.push(executed);
  }

  return {
    executedToolCalls: results,
    pendingToolCalls: pendingConfirmTools,
    iterationCount: state.iterationCount + 1,
  };
}

/**
 * 请求确认节点
 */
async function requestConfirmationNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.pendingToolExecution) {
    return { status: 'completed' as AgentState['status'] };
  }

  const decision = interrupt({
    toolName: state.pendingToolExecution.toolName,
    arguments: state.pendingToolExecution.arguments,
    confirmationMessage: state.pendingToolExecution.confirmationMessage,
  });

  if (decision === 'confirmed') {
    return { status: 'running' as AgentState['status'], requiresConfirmation: false };
  }

  return {
    status: 'cancelled' as AgentState['status'],
    requiresConfirmation: false,
    pendingToolExecution: null,
  };
}

/**
 * 执行确认工具节点
 */
async function executeConfirmedToolNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.confirmedToolCall) {
    return {};
  }

  const executed = await executeToolCallInternal(state.confirmedToolCall);

  return {
    executedToolCalls: [executed],
    confirmedToolCall: null,
    pendingToolExecution: null,
    ...(executed.error ? { error: executed.error, status: 'failed' as AgentState['status'] } : {}),
  };
}

/**
 * 完成节点
 */
async function finalizeNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  return {
    finalText: lastMessage?.content || '',
    status: state.error ? 'failed' as AgentState['status'] : 'completed' as AgentState['status'],
  };
}

// ============ 条件路由函数 ============

/**
 * 解析后路由
 */
function afterParseRouter(state: AgentState): string {
  if (state.status === 'cancelled' || state.status === 'failed') return 'finalize';
  if (state.iterationCount >= MAX_ITERATIONS) return 'finalize';
  if (state.pendingToolCalls.length === 0) return 'finalize';
  return 'check_confirmation';
}

/**
 * 确认检查后路由
 */
function afterCheckConfirmationRouter(state: AgentState): string {
  if (state.requiresConfirmation) return 'request_confirmation';
  if (state.pendingToolCalls.length > 0) return 'execute_tools';
  return 'finalize';
}

/**
 * 执行工具后路由
 */
function afterExecuteRouter(state: AgentState): string {
  if (state.status === 'cancelled' || state.status === 'failed') return 'finalize';
  if (state.iterationCount >= MAX_ITERATIONS) return 'finalize';
  return 'build_messages';
}

/**
 * 确认请求后路由
 */
function afterConfirmationRequestRouter(state: AgentState): string {
  if (state.confirmedToolCall) return 'execute_confirmed_tool';
  if (state.status === 'cancelled') return 'finalize';
  return 'build_messages';
}

// ============ 构建 Graph ============

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode('init', initNode)
  .addNode('build_messages', buildMessagesNode)
  .addNode('call_model', callModelNode)
  .addNode('parse_tools', parseToolsNode)
  .addNode('check_confirmation', checkConfirmationNode)
  .addNode('execute_tools', executeToolsNode)
  .addNode('request_confirmation', requestConfirmationNode)
  .addNode('execute_confirmed_tool', executeConfirmedToolNode)
  .addNode('finalize', finalizeNode)

  .addEdge('__start__', 'init')
  .addEdge('init', 'build_messages')
  .addEdge('build_messages', 'call_model')
  .addEdge('call_model', 'parse_tools')

  .addConditionalEdges('parse_tools', afterParseRouter)
  .addConditionalEdges('check_confirmation', afterCheckConfirmationRouter)
  .addConditionalEdges('execute_tools', afterExecuteRouter)
  .addConditionalEdges('request_confirmation', afterConfirmationRequestRouter)
  .addConditionalEdges('execute_confirmed_tool', afterExecuteRouter)

  .addEdge('finalize', END);

export const agentGraph = workflow.compile();

/**
 * 执行 Agent
 */
export async function executeAgentGraph(
  input: {
    inputText: string;
    initialMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    provider: AgentState['provider'];
    model: string;
    runId: string;
    userId: string;
    systemPrompt?: string;
  }
): Promise<AgentState> {
  const initialState: Partial<AgentState> = {
    inputText: input.inputText,
    initialMessages: input.initialMessages,
    provider: input.provider,
    model: input.model,
    runId: input.runId,
    userId: input.userId,
    systemPrompt: input.systemPrompt || SYSTEM_PROMPT,
  };

  const result = await agentGraph.invoke(initialState, {
    configurable: { thread_id: input.runId },
  });

  return result;
}

/**
 * 继续执行（用户确认后）
 */
export async function continueAgentGraph(
  runId: string,
  confirmedToolCall: ToolCall
): Promise<AgentState> {
  const result = await agentGraph.invoke(
    { confirmedToolCall },
    { configurable: { thread_id: runId } }
  );

  return result;
}