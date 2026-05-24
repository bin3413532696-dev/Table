import { StateGraph, END, Command, interrupt } from '@langchain/langgraph';
import { HumanMessage, SystemMessage, AIMessage, AIMessageChunk } from '@langchain/core/messages';
import type { AgentState, ToolCall, ExecutedToolCall, TimelineEvent, ConversationMessage } from './state';
import { AgentStateAnnotation, MAX_ITERATIONS } from './state';
import { createStreamingChatModel, createChatModelWithTools, streamLlmDirect } from './chatModel';
import { parseToolCalls, getCachedResult, setCachedResult, parseToolCallsFromResponse } from './parser';
import { SYSTEM_PROMPT, buildToolResultPrompt } from './prompts';
import { allTools, requiresConfirmation } from './tools';
import { getCheckpointer } from './postgres-checkpointer';
import { MessageManager } from './message-manager';
import { ragConfig } from '../../knowledge-rag/config';

function now() {
  return Date.now();
}

function isoNow() {
  return new Date().toISOString();
}

const LLM_TIMEOUT_MS = Number(process.env.AGENT_LLM_TIMEOUT_MS) || 180000; // 默认 180 秒，适应慢速模型首token

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
    console.error(`[Agent Tool] Tool not found: ${toolCall.name}`);
    return {
      ...toolCall,
      result: null,
      success: false,
      error: `不支持的工具: ${toolCall.name}`,
      status: 'failed',
      createdAt: now(),
    };
  }

  console.log(`[Agent Tool] Executing: ${toolCall.name}`);
  console.log(`[Agent Tool] Arguments: ${JSON.stringify(toolCall.arguments).slice(0, 200)}${JSON.stringify(toolCall.arguments).length > 200 ? '...' : ''}`);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as any).invoke(toolCall.arguments);

    // 日志结果摘要
    if (typeof result === 'string') {
      const preview = result.slice(0, 100);
      console.log(`[Agent Tool] ${toolCall.name} succeeded (string result, ${result.length} chars): ${preview}...`);
    } else if (result && typeof result === 'object') {
      console.log(`[Agent Tool] ${toolCall.name} succeeded (object result): ${JSON.stringify(result).slice(0, 100)}...`);
    } else {
      console.log(`[Agent Tool] ${toolCall.name} succeeded`);
    }

    return {
      ...toolCall,
      result,
      success: true,
      status: 'completed',
      createdAt: now(),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Agent Tool] ${toolCall.name} failed: ${errorMsg}`);
    return {
      ...toolCall,
      result: null,
      success: false,
      error: errorMsg,
      status: 'failed',
      createdAt: now(),
    };
  }
}

async function initNode(state: AgentState): Promise<Partial<AgentState>> {
  // 只重置本轮相关的控制状态，保留跨轮次累积的状态（messages、executedToolCalls）
  // messages 和 executedToolCalls 由 buildMessagesNode 和后续节点管理
  // 注意：不要重置 inputText，它需要在 buildMessagesNode 中使用
  return {
    modelInputMessages: [],
    pendingToolCalls: [],
    iterationCount: 0,
    inputAppended: false,
    status: 'running',
    requiresConfirmation: false,
    pendingToolExecution: null,
    confirmedToolCall: null,
    error: null,
    assistantTextChunks: [],
    timeline: state.timeline?.length ? state.timeline : [],
    finalText: '',
  };
}

async function buildMessagesNode(state: AgentState): Promise<Partial<AgentState>> {
  const timestamp = now();
  const existingMessages = state.messages || [];
  const newMessages: ConversationMessage[] = [];

  // 如果没有历史消息，添加 system prompt
  if (existingMessages.length === 0) {
    newMessages.push({ role: 'system', content: state.systemPrompt || SYSTEM_PROMPT, createdAt: timestamp });
  }

  // 注入 initialMessages（仅在对话刚开始时）
  const normalizedInitialMessages = state.initialMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      createdAt: timestamp,
    }));

  if (existingMessages.length <= 1 && normalizedInitialMessages.length > 0) {
    newMessages.push(...normalizedInitialMessages);
  }

  // 添加本轮用户输入
  if (!state.inputAppended && state.inputText) {
    newMessages.push({ role: 'user', content: state.inputText, createdAt: timestamp });
  }

  // 构建发送给模型的完整消息列表
  const modelInputMessages = [...existingMessages, ...newMessages];
  if (state.executedToolCalls.length > 0) {
    const toolResultMessage = {
      role: 'user' as const,
      content: buildToolResultPrompt(state.executedToolCalls, state.searchMaxScore),
      createdAt: timestamp,
    };
    modelInputMessages.push(toolResultMessage);
    // 将工具结果消息也添加到 newMessages，确保保存到 checkpoint
    newMessages.push(toolResultMessage);
  }

  return {
    messages: newMessages, // 只返回新消息，避免重复追加
    modelInputMessages,
    inputAppended: true,
  };
}

async function callModelNode(state: AgentState): Promise<Partial<AgentState>> {
  // 使用 bindTools 创建支持原生 Function Calling 的 ChatModel
  const chatModel = createChatModelWithTools(state.provider, state.model, allTools);
  let lcMessages = state.modelInputMessages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  const messageManager = MessageManager.fromProviderConfig(state.provider, state.model);
  lcMessages = (await messageManager.trim(lcMessages)) as typeof lcMessages;

  const startTs = isoNow();

  console.log(`[Agent LLM] Calling model ${state.model} with ${lcMessages.length} messages`);

  // 关键改动：使用 invoke 而不是 stream + for await
  // LangGraph 的 streamMode: ['messages'] 会自动捕获 LLM 的 token 级输出
  // 但前提是节点不内部消费 stream
  // 这里使用 invoke，让 LangGraph 在 stream 模式下自动处理流式输出
  const response = await withTimeout(
    chatModel.invoke(lcMessages),
    LLM_TIMEOUT_MS,
    `LLM request (${state.model})`
  );

  const responseContent =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
                return part.text;
              }
              return '';
            })
            .join('')
        : '';

  // 从响应中提取原生 tool_calls（如果存在）
  const nativeToolCalls = parseToolCallsFromResponse(response);

  console.log(`[Agent LLM] Response length: ${responseContent.length} chars, tool_calls: ${nativeToolCalls.length}`);
  if (nativeToolCalls.length > 0) {
    console.log(`[Agent LLM] Native tool_calls: ${nativeToolCalls.map(tc => tc.name).join(', ')}`);
  }

  return {
    messages: [{ role: 'assistant', content: responseContent, createdAt: now() }],
    assistantTextChunks: [responseContent],
    // 传递原生 tool_calls 到 parseToolsNode
    pendingToolCalls: nativeToolCalls,
    timeline: appendTimeline(state, {
      type: 'llm_start',
      timestamp: startTs,
      data: { model: state.model },
    }).concat({
      type: 'llm_end',
      timestamp: isoNow(),
      data: { model: state.model, hasToolCalls: nativeToolCalls.length > 0 },
    }),
  };
}

async function parseToolsNode(state: AgentState): Promise<Partial<AgentState>> {
  const lastMessage = state.messages[state.messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant') {
    console.log('[Agent Parser] No assistant message to parse');
    return { pendingToolCalls: [] };
  }

  // 如果 callModelNode 已经提取了原生 tool_calls，直接使用
  if (state.pendingToolCalls.length > 0) {
    console.log(`[Agent Parser] Using native tool_calls from LLM: ${state.pendingToolCalls.map(tc => tc.name).join(', ')}`);
    return { pendingToolCalls: state.pendingToolCalls };
  }

  // 兼容模式：从文本中解析工具调用（当原生 Function Calling 不支持时）
  console.log('[Agent Parser] No native tool_calls, attempting text parsing fallback');
  const { toolCalls } = parseToolCalls(lastMessage.content);

  if (toolCalls.length > 0) {
    console.log(`[Agent Parser] Text parsing found tool_calls: ${toolCalls.map(tc => tc.name).join(', ')}`);
  } else {
    console.log('[Agent Parser] No tool_calls found in text');
  }

  return {
    pendingToolCalls: toolCalls,
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

  // 新增：累积搜索结果和引用
  const newSearchResults: AgentState['accumulatedSearchResults'] = [];
  const newCitedChunkIds: string[] = [];
  let newSearchMaxScore = state.searchMaxScore ?? 0;

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

      // 新增：检测搜索工具并累积结果
      if (toolCall.name === 'semantic_search' || toolCall.name === 'keyword_search') {
        // 从 XML 结果中提取 chunk 信息
        const xmlResult = executed.result as string;

        // 提取原始语义最高分数（用于 Retrieval Grader）
        const originalSemanticMaxMatch = xmlResult.match(/<original_semantic_max_score>([^<]+)<\/original_semantic_max_score>/);
        if (originalSemanticMaxMatch) {
          const originalSemanticScore = parseFloat(originalSemanticMaxMatch[1]);
          // 使用原始语义分数，而非融合后分数
          newSearchMaxScore = Math.max(newSearchMaxScore, originalSemanticScore);
        }

        const chunkMatches = xmlResult.matchAll(/<chunk id="([^"]+)">\s*<source>([^<]*)<\/source>\s*<score>([^<]*)<\/score>\s*<content>([^<]*)<\/content>\s*<\/chunk>/g);
        for (const match of chunkMatches) {
          const chunkId = match[1];
          const source = match[2];
          const score = parseFloat(match[3]);
          const content = match[4];
          // 提取 documentTitle 和 headingChain
          const [docTitle, heading] = source.includes(' > ') ? source.split(' > ') : [source, undefined];
          newSearchResults.push({
            id: chunkId,
            documentId: '', // 从 XML 中无法获取，但 ID 已足够用于验证
            documentTitle: docTitle,
            headingChain: heading,
            content,
            chunkIndex: 0,
            score,
            source: toolCall.name === 'semantic_search' ? 'semantic' : 'keyword',
          });
        }
      }

      // 新增：检测 cite_sources 工具并记录引用
      if (toolCall.name === 'cite_sources') {
        const citeResult = executed.result as { cited?: string[] };
        if (citeResult?.cited) {
          newCitedChunkIds.push(...citeResult.cited);
        }
      }
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
    // 新增：累积搜索结果和引用
    accumulatedSearchResults: newSearchResults.length > 0
      ? [...(state.accumulatedSearchResults ?? []), ...newSearchResults]
      : state.accumulatedSearchResults,
    citedChunkIds: newCitedChunkIds.length > 0
      ? [...(state.citedChunkIds ?? []), ...newCitedChunkIds]
      : state.citedChunkIds,
    searchMaxScore: newSearchMaxScore > (state.searchMaxScore ?? 0) ? newSearchMaxScore : state.searchMaxScore,
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

/**
 * Grounding Guardrail Node（P2-G6）
 * 验证 RAG 引用的有效性
 * 根据 CITATION_REQUIRED_FOR_FACTS 配置决定严格程度
 */
async function groundingGuardrailNode(state: AgentState): Promise<Partial<AgentState>> {
  // 检查是否使用了 RAG 搜索工具
  const ragSearchTools = state.executedToolCalls.filter(tc =>
    tc.name === 'semantic_search' || tc.name === 'keyword_search' || tc.name === 'search_knowledge_rag' || tc.name === 'rag_answer'
  );

  // 未使用 RAG 工具时，跳过验证
  if (ragSearchTools.length === 0) {
    console.log('[Agent Grounding] No RAG tools used, skipping guardrail');
    return {};
  }

  console.log(`[Agent Grounding] RAG tools used: ${ragSearchTools.map(t => t.name).join(', ')}, searchMaxScore: ${state.searchMaxScore}`);

  // rag_answer 是一体化工具，不需要单独 cite_sources 验证
  const hasRagAnswer = ragSearchTools.some(tc => tc.name === 'rag_answer');

  if (hasRagAnswer) {
    console.log('[Agent Grounding] rag_answer tool used, skipping citation requirement (unified tool)');
    return {};
  }

  // 检查是否调用了 cite_sources（仅对 semantic_search/keyword_search 需要）
  const citeTools = state.executedToolCalls.filter(tc => tc.name === 'cite_sources');

  // 低相关度搜索时，放宽引用要求（不强制失败）
  const maxScore = state.searchMaxScore ?? 0;
  const isLowQualitySearch = maxScore < ragConfig.CITATION_LOW_SCORE_THRESHOLD;

  if (citeTools.length === 0) {
    // 如果配置允许不引用，或搜索质量低，仅记录警告不阻止回答
    if (!ragConfig.CITATION_REQUIRED_FOR_FACTS || isLowQualitySearch) {
      console.warn(`[Agent Grounding] RAG search used without citation (maxScore: ${maxScore.toFixed(3)}, lowQuality: ${isLowQualitySearch}, required: ${ragConfig.CITATION_REQUIRED_FOR_FACTS})`);
      // 返回空状态，允许回答继续
      return {};
    }

    // 配置要求强制引用且搜索质量足够高，返回失败
    console.log('[Agent Grounding] Citation required but not provided, marking as failed');
    return {
      error: '使用了知识库搜索但未标注引用来源。请调用 cite_sources(chunkIds) 标注引用。',
      status: 'failed',
    };
  }

  // 验证引用的 chunk ID 存在于累积的搜索结果中
  const validChunkIds = new Set((state.accumulatedSearchResults ?? []).map(r => r.id));
  const citedIds = state.citedChunkIds ?? [];
  const invalidCitations = citedIds.filter(id => !validChunkIds.has(id));

  if (invalidCitations.length > 0) {
    console.warn(`[Agent Grounding] Invalid citations: ${invalidCitations.slice(0, 3).join(', ')}`);
    return {
      error: `引用的 chunk ID 不在本轮搜索结果中: ${invalidCitations.slice(0, 3).join(', ')}`,
      status: 'failed',
    };
  }

  // 引用验证通过
  console.log(`[Agent Grounding] Citation validation passed: ${citedIds.length} valid citations`);
  return {};
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
  if (state.iterationCount >= MAX_ITERATIONS) return 'grounding_guardrail'; // 先去 guardrail
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
  .addNode('grounding_guardrail', groundingGuardrailNode) // 新增
  .addNode('finalize', finalizeNode)
  .addEdge('__start__', 'init')
  .addEdge('init', 'build_messages')
  .addEdge('build_messages', 'call_model')
  .addEdge('call_model', 'parse_tools')
  .addConditionalEdges('parse_tools', afterParseRouter)
  .addConditionalEdges('check_confirmation', afterCheckConfirmationRouter)
  .addConditionalEdges('execute_tools', afterExecuteRouter)
  .addConditionalEdges('execute_confirmed_tool', afterExecuteRouter)
  .addEdge('grounding_guardrail', 'finalize') // guardrail → finalize
  .addEdge('finalize', END);

export const agentGraph = workflow.compile({
  checkpointer: getCheckpointer(),
});

export type AgentGraphStreamChunk =
  | { mode: 'values'; data: AgentState }
  | { mode: 'messages'; data: unknown }
  | { mode: 'tasks'; data: unknown }
  | { mode: 'token'; data: { token: string } };

/**
 * 流式token回调类型
 * 在streamAgentGraph中使用，允许外部接收token级事件
 */
export type TokenCallback = (token: string) => Promise<void> | void;

async function resolveFinalState(threadId: string): Promise<AgentState> {
  const snapshot = await agentGraph.getState({
    configurable: { thread_id: threadId },
  });

  if (snapshot?.values) {
    return snapshot.values as AgentState;
  }

  throw new Error(`Missing checkpoint state for thread ${threadId}`);
}

export async function executeAgentGraph(input: {
  inputText: string;
  initialMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  provider: AgentState['provider'];
  model: string;
  runId: string;
  threadId: string;
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
    configurable: { thread_id: input.threadId },
  });
}

/**
 * 直接流式执行Agent
 * 绕过LangGraph节点的stream消费问题，直接调用LLM并发送token级输出
 */
export async function streamAgentGraphDirect(input: {
  inputText: string;
  initialMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  provider: AgentState['provider'];
  model: string;
  runId: string;
  threadId: string;
  userId: string;
  systemPrompt?: string;
  onToken: (token: string) => Promise<void> | void;
  onChunk: (chunk: AgentGraphStreamChunk) => Promise<void> | void;
}): Promise<AgentState> {
  const { onToken, onChunk } = input;

  // 构建消息（复制 buildMessagesNode 的逻辑）
  const timestamp = now();
  const messages: ConversationMessage[] = [];

  // System prompt
  messages.push({ role: 'system', content: input.systemPrompt || SYSTEM_PROMPT, createdAt: timestamp });

  // Initial messages
  const normalizedInitialMessages = input.initialMessages
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      createdAt: timestamp,
    }));
  messages.push(...normalizedInitialMessages);

  // User input
  messages.push({ role: 'user', content: input.inputText, createdAt: timestamp });

  // 直接调用LLM流式API
  const startTs = isoNow();

  // 先使用 invoke 获取完整响应（包含 tool_calls）
  // 因为 MiniMax 等模型在流式模式下 tool_calls 聚合有问题
  const chatModel = createChatModelWithTools(input.provider, input.model, allTools);
  const lcMessages = messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  const response = await withTimeout(
    chatModel.invoke(lcMessages),
    LLM_TIMEOUT_MS,
    `LLM request (${input.model})`
  );

  const responseContent =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .map((part) => {
              if (typeof part === 'string') return part;
              if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
                return part.text;
              }
              return '';
            })
            .join('')
        : '';

  // 发送完整内容作为 token
  if (responseContent) {
    await onToken(responseContent);
  }

  // 从响应中提取原生 tool_calls
  const nativeToolCalls = parseToolCallsFromResponse(response);

  const result: { content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> } = {
    content: responseContent,
    toolCalls: nativeToolCalls,
  };

  const assistantMessage: ConversationMessage = {
    role: 'assistant',
    content: result.content,
    createdAt: now(),
  };
  messages.push(assistantMessage);

  // 如果原生 tool_calls 为空，尝试从文本中解析（回退机制）
  let effectiveToolCalls = result.toolCalls;
  if (effectiveToolCalls.length === 0 && result.content) {
    const { toolCalls } = parseToolCalls(result.content);
    if (toolCalls.length > 0) {
      effectiveToolCalls = toolCalls;
      console.log('[Agent] 从文本解析到工具调用:', toolCalls.map(tc => tc.name).join(', '));
    }
  }

  // 发送values chunk
  const partialState: Partial<AgentState> = {
    messages: [assistantMessage],
    assistantTextChunks: [result.content],
    pendingToolCalls: effectiveToolCalls,
    timeline: [
      { type: 'llm_start', timestamp: startTs, data: { model: input.model } },
      { type: 'llm_end', timestamp: isoNow(), data: { model: input.model, hasToolCalls: effectiveToolCalls.length > 0 } },
    ],
  };
  await onChunk({ mode: 'values', data: partialState as AgentState });

  // 如果有tool_calls，执行后续处理
  let state: Partial<AgentState> = {
    inputText: input.inputText,
    initialMessages: input.initialMessages,
    provider: input.provider,
    model: input.model,
    runId: input.runId,
    userId: input.userId,
    systemPrompt: input.systemPrompt || SYSTEM_PROMPT,
    messages,
    modelInputMessages: messages,
    executedToolCalls: [],
    pendingToolCalls: effectiveToolCalls,
    iterationCount: 0,
    inputAppended: true,
    status: 'running',
    requiresConfirmation: false,
    pendingToolExecution: null,
    confirmedToolCall: null,
    error: null,
    assistantTextChunks: [result.content],
    timeline: partialState.timeline || [],
    finalText: '',
  };

  // 处理工具调用循环
  while (state.pendingToolCalls!.length > 0 && state.iterationCount! < MAX_ITERATIONS) {
    // 检查是否需要确认
    for (const toolCall of state.pendingToolCalls!) {
      if (requiresConfirmation(toolCall.name)) {
        state = {
          ...state,
          requiresConfirmation: true,
          status: 'waiting_confirmation',
          pendingToolExecution: {
            id: toolCall.id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            confirmationMessage: `即将执行 ${toolCall.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`,
          },
        };
        await onChunk({ mode: 'values', data: state as AgentState });
        return state as AgentState;
      }
    }

    // 执行工具
    const accumulated: ExecutedToolCall[] = [...(state.executedToolCalls ?? [])];
    let timeline = [...(state.timeline ?? [])];

    for (const toolCall of state.pendingToolCalls!) {
      if (requiresConfirmation(toolCall.name)) continue;

      const toolStartTs = isoNow();
      timeline.push({
        type: 'tool_start',
        timestamp: toolStartTs,
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
      }
      accumulated.push(executed);
      timeline.push({
        type: 'tool_end',
        timestamp: isoNow(),
        data: { toolName: toolCall.name, success: executed.success },
      });
    }

    state = {
      ...state,
      executedToolCalls: accumulated,
      pendingToolCalls: [],
      iterationCount: (state.iterationCount ?? 0) + 1,
      timeline,
    };

    await onChunk({ mode: 'values', data: state as AgentState });

    // 如果有工具执行结果，再次调用LLM
    if (accumulated.length > 0 && (state.iterationCount ?? 0) < MAX_ITERATIONS) {
      // 构建工具结果消息
      const toolResultMessage: ConversationMessage = {
        role: 'user',
        content: buildToolResultPrompt(accumulated),
        createdAt: now(),
      };
      messages.push(toolResultMessage);

      // 再次调用LLM
      const nextResult = await streamLlmDirect({
        provider: input.provider,
        model: input.model,
        messages,
        tools: allTools,
        timeoutMs: LLM_TIMEOUT_MS,
        onToken,
      });

      const nextAssistantMessage: ConversationMessage = {
        role: 'assistant',
        content: nextResult.content,
        createdAt: now(),
      };
      messages.push(nextAssistantMessage);

      // MiniMax fallback: 如果原生 tool_calls 为空，尝试从文本解析
      let effectiveNextToolCalls = nextResult.toolCalls;
      if (effectiveNextToolCalls.length === 0 && nextResult.content) {
        const { toolCalls } = parseToolCalls(nextResult.content);
        if (toolCalls.length > 0) {
          effectiveNextToolCalls = toolCalls;
          console.log('[Agent] 后续调用从文本解析到工具调用:', toolCalls.map(tc => tc.name).join(', '));
        }
      }

      state = {
        ...state,
        messages,
        pendingToolCalls: effectiveNextToolCalls,
        assistantTextChunks: [...(state.assistantTextChunks ?? []), nextResult.content],
      };

      await onChunk({ mode: 'values', data: state as AgentState });
    }
  }

  // 最终状态
  // finalText 应为最后一次 LLM 生成的文本内容，而非第一次
  const assistantChunks = state.assistantTextChunks ?? [];
  const lastAssistantText = assistantChunks.length > 0
    ? assistantChunks[assistantChunks.length - 1]
    : result.content;

  state = {
    ...state,
    status: state.error ? 'failed' : 'completed',
    finalText: lastAssistantText,
  };

  // 保存到checkpoint
  await agentGraph.updateState({
    configurable: { thread_id: input.threadId },
  }, state);

  await onChunk({ mode: 'values', data: state as AgentState });
  return state as AgentState;
}

export async function streamAgentGraph(input: {
  inputText: string;
  initialMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  provider: AgentState['provider'];
  model: string;
  runId: string;
  threadId: string;
  userId: string;
  systemPrompt?: string;
  onChunk: (chunk: AgentGraphStreamChunk) => Promise<void> | void;
  onToken?: TokenCallback;
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
    configurable: { thread_id: input.threadId },
    streamMode: ['messages', 'values', 'tasks'],
  });

  let lastValues: AgentState | undefined;

  for await (const chunk of stream) {
    if (!Array.isArray(chunk) || chunk.length < 2) {
      continue;
    }

    const [mode, data] = chunk as [string, unknown];
    if (mode !== 'values' && mode !== 'tasks' && mode !== 'messages') {
      continue;
    }

    // 处理 messages 模式的 chunk：提取 token 级内容
    if (mode === 'messages' && input.onToken) {
      try {
        const messageTuple = data as [Record<string, unknown>, AIMessageChunk];
        const messageChunk = messageTuple[1];
        if (messageChunk?.content) {
          const content = messageChunk.content;
          let token = '';
          if (typeof content === 'string') {
            token = content;
          } else if (Array.isArray(content)) {
            token = content
              .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
                  return part.text;
                }
                return '';
              })
              .join('');
          }
          if (token) {
            await input.onToken(token);
          }
        }
      } catch {
        // 忽略解析错误
      }
    }

    if (mode === 'values') {
      lastValues = data as AgentState;
    }

    await input.onChunk({ mode, data } as AgentGraphStreamChunk);
  }

  if (lastValues) {
    return lastValues;
  }
  return resolveFinalState(input.threadId);
}

export async function continueAgentGraph(threadId: string, approved: boolean): Promise<AgentState> {
  return agentGraph.invoke(new Command({ resume: approved }), {
    configurable: { thread_id: threadId },
  });
}

export async function streamContinueAgentGraph(input: {
  runId: string;
  threadId: string;
  approved: boolean;
  onChunk: (chunk: AgentGraphStreamChunk) => Promise<void> | void;
  onToken?: TokenCallback;
}): Promise<AgentState> {
  const stream = await agentGraph.stream(new Command({ resume: input.approved }), {
    configurable: { thread_id: input.threadId },
    streamMode: ['messages', 'values', 'tasks'],
  });

  let lastValues: AgentState | undefined;

  for await (const chunk of stream) {
    if (!Array.isArray(chunk) || chunk.length < 2) {
      continue;
    }

    const [mode, data] = chunk as [string, unknown];
    if (mode !== 'values' && mode !== 'tasks' && mode !== 'messages') {
      continue;
    }

    // 处理 messages 模式的 chunk：提取 token 级内容
    if (mode === 'messages' && input.onToken) {
      try {
        const messageTuple = data as [Record<string, unknown>, AIMessageChunk];
        const messageChunk = messageTuple[1];
        if (messageChunk?.content) {
          const content = messageChunk.content;
          let token = '';
          if (typeof content === 'string') {
            token = content;
          } else if (Array.isArray(content)) {
            token = content
              .map((part) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
                  return part.text;
                }
                return '';
              })
              .join('');
          }
          if (token) {
            await input.onToken(token);
          }
        }
      } catch {
        // 忽略解析错误
      }
    }

    if (mode === 'values') {
      lastValues = data as AgentState;
    }

    await input.onChunk({ mode, data } as AgentGraphStreamChunk);
  }

  if (lastValues) {
    return lastValues;
  }
  return resolveFinalState(input.threadId);
}
