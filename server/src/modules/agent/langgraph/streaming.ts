import type { AgentState } from './state';
import { createStreamingChatModel } from './chatModel';
import { SYSTEM_PROMPT, buildToolResultPrompt } from './prompts';
import { parseToolCalls, getCachedResult, setCachedResult } from './parser';
import { allTools, requiresConfirmation } from './tools';
import type { ToolCall, ExecutedToolCall, PendingToolExecution } from './state';

/**
 * SSE 流式事件类型
 */
export type StreamEvent =
  | { type: 'status'; runId: string; status: AgentState['status'] }
  | { type: 'text_chunk'; runId: string; text: string }
  | { type: 'tool_call'; runId: string; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; runId: string; toolName: string; result: unknown; success: boolean }
  | { type: 'confirmation_request'; runId: string; pendingToolExecution: PendingToolExecution }
  | { type: 'error'; runId: string; error: string };

/**
 * SSE 事件发射器
 */
export type StreamEventEmitter = (event: StreamEvent) => Promise<void> | void;

/**
 * 流式执行 Agent（替代 LangGraph 的 streamEvents）
 * 由于 LangGraph 的 interrupt 机制需要持久化，我们使用简化的流式执行
 */
export async function executeAgentRunWithStream(
  input: {
    inputText: string;
    initialMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    provider: AgentState['provider'];
    model: string;
    runId: string;
    userId: string;
    systemPrompt?: string;
  },
  emit: StreamEventEmitter
): Promise<AgentState> {
  const MAX_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 5;
  const systemPrompt = input.systemPrompt || SYSTEM_PROMPT;

  // 发送开始状态
  await emit({ type: 'status', runId: input.runId, status: 'running' });

  // 构建初始消息
  let messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...input.initialMessages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: input.inputText },
  ];

  const executedToolCalls: ExecutedToolCall[] = [];
  let iteration = 0;

  try {
    while (iteration < MAX_ITERATIONS) {
      // 创建流式 ChatModel
      const chatModel = createStreamingChatModel(input.provider, input.model);

      // 调用 LLM（流式）
      let fullResponse = '';

      // 流式调用
      const stream = await chatModel.stream(
        messages.map(m => {
          if (m.role === 'system') return { type: 'system', content: m.content };
          if (m.role === 'assistant') return { type: 'ai', content: m.content };
          return { type: 'human', content: m.content };
        })
      );

      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string' ? chunk.content : '';
        if (text) {
          fullResponse += text;
          await emit({ type: 'text_chunk', runId: input.runId, text });
        }
      }

      // 解析工具调用
      const { textContent, toolCalls } = parseToolCalls(fullResponse);
      messages.push({ role: 'assistant', content: textContent });

      if (toolCalls.length === 0) {
        // 无工具调用，完成
        await emit({ type: 'status', runId: input.runId, status: 'completed' });
        return {
          ...input,
          messages,
          executedToolCalls,
          finalText: textContent,
          status: 'completed',
          iterationCount: iteration,
        } as AgentState;
      }

      // 检查是否有需要确认的工具
      for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        if (requiresConfirmation(toolCall.name)) {
          // 执行之前的查询类工具
          const queryTools = toolCalls.slice(0, i);
          for (const queryTool of queryTools) {
            await emit({ type: 'tool_call', runId: input.runId, toolName: queryTool.name, arguments: queryTool.arguments });

            const cached = getCachedResult(queryTool.name, queryTool.arguments);
            if (cached !== null) {
              executedToolCalls.push({ ...queryTool, result: cached, success: true });
              await emit({ type: 'tool_result', runId: input.runId, toolName: queryTool.name, result: cached, success: true });
              continue;
            }

            const tool = allTools.find(t => t.name === queryTool.name);
            if (!tool) continue;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (tool as any).invoke(queryTool.arguments);
            setCachedResult(queryTool.name, queryTool.arguments, result);
            executedToolCalls.push({ ...queryTool, result, success: true });
            await emit({ type: 'tool_result', runId: input.runId, toolName: queryTool.name, result, success: true });
          }

          // 发送确认请求
          const pendingToolExecution: PendingToolExecution = {
            id: toolCall.id,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
            confirmationMessage: `即将执行 ${toolCall.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`,
          };

          await emit({ type: 'confirmation_request', runId: input.runId, pendingToolExecution });
          await emit({ type: 'status', runId: input.runId, status: 'waiting_confirmation' });

          return {
            ...input,
            messages,
            executedToolCalls,
            pendingToolCalls: toolCalls.slice(i),
            pendingToolExecution,
            requiresConfirmation: true,
            status: 'waiting_confirmation',
            iterationCount: iteration,
          } as AgentState;
        }
      }

      // 所有工具都是查询类，并行执行
      for (const toolCall of toolCalls) {
        await emit({ type: 'tool_call', runId: input.runId, toolName: toolCall.name, arguments: toolCall.arguments });

        const cached = getCachedResult(toolCall.name, toolCall.arguments);
        if (cached !== null) {
          executedToolCalls.push({ ...toolCall, result: cached, success: true });
          await emit({ type: 'tool_result', runId: input.runId, toolName: toolCall.name, result: cached, success: true });
          continue;
        }

        const tool = allTools.find(t => t.name === toolCall.name);
        if (!tool) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (tool as any).invoke(toolCall.arguments);
        setCachedResult(toolCall.name, toolCall.arguments, result);
        executedToolCalls.push({ ...toolCall, result, success: true });
        await emit({ type: 'tool_result', runId: input.runId, toolName: toolCall.name, result, success: true });
      }

      // 构建工具结果消息，继续循环
      messages.push({
        role: 'user',
        content: buildToolResultPrompt(executedToolCalls.slice(-toolCalls.length)),
      });

      iteration++;
    }

    // 达到最大迭代次数
    await emit({ type: 'status', runId: input.runId, status: 'completed' });
    return {
      ...input,
      messages,
      executedToolCalls,
      finalText: messages[messages.length - 1]?.content || '',
      status: 'completed',
      iterationCount: iteration,
    } as AgentState;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '执行失败';
    await emit({ type: 'error', runId: input.runId, error: errorMsg });
    await emit({ type: 'status', runId: input.runId, status: 'failed' });
    return {
      ...input,
      messages,
      executedToolCalls,
      error: errorMsg,
      status: 'failed',
      iterationCount: iteration,
    } as AgentState;
  }
}

/**
 * 继续执行（用户确认后）
 */
export async function continueAgentRunWithStream(
  state: AgentState,
  confirmedToolCall: ToolCall,
  emit: StreamEventEmitter
): Promise<AgentState> {
  const MAX_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 5;

  await emit({ type: 'status', runId: state.runId, status: 'running' });

  // 执行确认的工具
  await emit({ type: 'tool_call', runId: state.runId, toolName: confirmedToolCall.name, arguments: confirmedToolCall.arguments });

  const tool = allTools.find(t => t.name === confirmedToolCall.name);
  if (!tool) {
    await emit({ type: 'error', runId: state.runId, error: `不支持的工具: ${confirmedToolCall.name}` });
    await emit({ type: 'status', runId: state.runId, status: 'failed' });
    return { ...state, status: 'failed', error: `不支持的工具: ${confirmedToolCall.name}` };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool as any).invoke(confirmedToolCall.arguments);
    const executedToolCall: ExecutedToolCall = { ...confirmedToolCall, result, success: true };
    state.executedToolCalls.push(executedToolCall);
    await emit({ type: 'tool_result', runId: state.runId, toolName: confirmedToolCall.name, result, success: true });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '工具执行失败';
    await emit({ type: 'error', runId: state.runId, error: errorMsg });
    await emit({ type: 'status', runId: state.runId, status: 'failed' });
    return { ...state, status: 'failed', error: errorMsg };
  }

  // 执行剩余的查询类工具
  const remainingTools = state.pendingToolCalls?.filter(tc => !requiresConfirmation(tc.name)) || [];
  for (const toolCall of remainingTools) {
    await emit({ type: 'tool_call', runId: state.runId, toolName: toolCall.name, arguments: toolCall.arguments });

    const cached = getCachedResult(toolCall.name, toolCall.arguments);
    if (cached !== null) {
      state.executedToolCalls.push({ ...toolCall, result: cached, success: true });
      await emit({ type: 'tool_result', runId: state.runId, toolName: toolCall.name, result: cached, success: true });
      continue;
    }

    const t = allTools.find(tt => tt.name === toolCall.name);
    if (!t) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (t as any).invoke(toolCall.arguments);
    setCachedResult(toolCall.name, toolCall.arguments, result);
    state.executedToolCalls.push({ ...toolCall, result, success: true });
    await emit({ type: 'tool_result', runId: state.runId, toolName: toolCall.name, result, success: true });
  }

  // 构建工具结果消息，继续调用 LLM
  let messages = [...state.messages];
  messages.push({
    role: 'user',
    content: buildToolResultPrompt(state.executedToolCalls.slice(-(state.executedToolCalls.length))),
  });

  let iteration = state.iterationCount + 1;

  while (iteration < MAX_ITERATIONS) {
    const chatModel = createStreamingChatModel(state.provider, state.model);
    let fullResponse = '';

    const stream = await chatModel.stream(
      messages.map(m => {
        if (m.role === 'system') return { type: 'system', content: m.content };
        if (m.role === 'assistant') return { type: 'ai', content: m.content };
        return { type: 'human', content: m.content };
      })
    );

    for await (const chunk of stream) {
      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (text) {
        fullResponse += text;
        await emit({ type: 'text_chunk', runId: state.runId, text });
      }
    }

    const { textContent, toolCalls } = parseToolCalls(fullResponse);
    messages.push({ role: 'assistant', content: textContent });

    if (toolCalls.length === 0) {
      await emit({ type: 'status', runId: state.runId, status: 'completed' });
      return { ...state, messages, finalText: textContent, status: 'completed', iterationCount: iteration };
    }

    // 检查是否需要再次确认
    for (let i = 0; i < toolCalls.length; i++) {
      const toolCall = toolCalls[i];
      if (requiresConfirmation(toolCall.name)) {
        // 执行查询类工具
        const queryTools = toolCalls.slice(0, i);
        for (const queryTool of queryTools) {
          await emit({ type: 'tool_call', runId: state.runId, toolName: queryTool.name, arguments: queryTool.arguments });
          const cached = getCachedResult(queryTool.name, queryTool.arguments);
          if (cached !== null) {
            state.executedToolCalls.push({ ...queryTool, result: cached, success: true });
            await emit({ type: 'tool_result', runId: state.runId, toolName: queryTool.name, result: cached, success: true });
            continue;
          }
          const t = allTools.find(tt => tt.name === queryTool.name);
          if (!t) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (t as any).invoke(queryTool.arguments);
          setCachedResult(queryTool.name, queryTool.arguments, result);
          state.executedToolCalls.push({ ...queryTool, result, success: true });
          await emit({ type: 'tool_result', runId: state.runId, toolName: queryTool.name, result, success: true });
        }

        const pendingToolExecution: PendingToolExecution = {
          id: toolCall.id,
          toolName: toolCall.name,
          arguments: toolCall.arguments,
          confirmationMessage: `即将执行 ${toolCall.name}，参数如下：\n${JSON.stringify(toolCall.arguments, null, 2)}`,
        };

        await emit({ type: 'confirmation_request', runId: state.runId, pendingToolExecution });
        await emit({ type: 'status', runId: state.runId, status: 'waiting_confirmation' });

        return {
          ...state,
          messages,
          pendingToolCalls: toolCalls.slice(i),
          pendingToolExecution,
          requiresConfirmation: true,
          status: 'waiting_confirmation',
          iterationCount: iteration,
        };
      }
    }

    // 执行所有查询类工具
    for (const toolCall of toolCalls) {
      await emit({ type: 'tool_call', runId: state.runId, toolName: toolCall.name, arguments: toolCall.arguments });
      const cached = getCachedResult(toolCall.name, toolCall.arguments);
      if (cached !== null) {
        state.executedToolCalls.push({ ...toolCall, result: cached, success: true });
        await emit({ type: 'tool_result', runId: state.runId, toolName: toolCall.name, result: cached, success: true });
        continue;
      }
      const t = allTools.find(tt => tt.name === toolCall.name);
      if (!t) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (t as any).invoke(toolCall.arguments);
      setCachedResult(toolCall.name, toolCall.arguments, result);
      state.executedToolCalls.push({ ...toolCall, result, success: true });
      await emit({ type: 'tool_result', runId: state.runId, toolName: toolCall.name, result, success: true });
    }

    messages.push({
      role: 'user',
      content: buildToolResultPrompt(state.executedToolCalls.slice(-toolCalls.length)),
    });

    iteration++;
  }

  await emit({ type: 'status', runId: state.runId, status: 'completed' });
  return { ...state, messages, finalText: messages[messages.length - 1]?.content || '', status: 'completed', iterationCount: iteration };
}