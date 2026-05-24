import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage, AIMessage, AIMessageChunk } from '@langchain/core/messages';
import type { ProviderConfig } from './state';
import type { DynamicStructuredTool } from '@langchain/core/tools';

/**
 * ChatModel 适配层
 * 根据 Provider 配置创建对应的 LangChain ChatModel
 */

/**
 * 验证 Provider baseUrl，防止 SSRF
 * - 仅允许 HTTPS 协议
 * - 阻止内网 IP 和云元数据地址
 */
export function validateProviderUrl(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Provider baseUrl 格式无效: ${baseUrl}`);
  }

  // 仅允许 HTTPS 协议
  if (url.protocol !== 'https:') {
    throw new Error(`Provider baseUrl 必须使用 HTTPS 协议，当前为: ${url.protocol}`);
  }

  const hostname = url.hostname.toLowerCase();

  // 阻止 localhost（生产环境）
  // 开发环境允许 localhost 以便使用本地 LLM（如 Ollama）
  if (process.env.NODE_ENV === 'production') {
    if (hostname === 'localhost' || hostname === 'localhost.localdomain') {
      throw new Error('Provider baseUrl 不允许指向 localhost（生产环境）');
    }
  }

  // 阻止云元数据地址
  if (hostname === '169.254.169.254') {
    throw new Error('Provider baseUrl 不允许指向云元数据地址');
  }

  // 阻止内网 IP 段
  const privateIpPatterns = [
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
    /^127\.\d+\.\d+\.\d+$/,
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^fc00:\/\//i,
    /^fe80:\/\//i,
  ];

  for (const pattern of privateIpPatterns) {
    if (pattern.test(hostname)) {
      throw new Error(`Provider baseUrl 不允许指向内网地址: ${hostname}`);
    }
  }
}

/**
 * 创建 ChatModel 实例
 */
export function createChatModel(provider: ProviderConfig, model: string): BaseChatModel {
  // 验证 baseUrl
  validateProviderUrl(provider.baseUrl);

  const baseUrl = provider.baseUrl.replace(/\/+$/, '');

  switch (provider.apiFormat) {
    case 'anthropic':
      return new ChatAnthropic({
        anthropicApiKey: provider.apiKey,
        modelName: model,
        maxTokens: 4096,
        clientOptions: {
          baseURL: baseUrl,
        },
      });

    case 'openai':
      return new ChatOpenAI({
        apiKey: provider.apiKey,
        modelName: model,
        maxTokens: 4096,
        timeout: 60000, // 60 秒超时
        configuration: {
          baseURL: baseUrl,
        },
      });

    case 'custom':
      // Custom 格式使用 OpenAI-compatible API
      return new ChatOpenAI({
        apiKey: provider.apiKey,
        modelName: model,
        maxTokens: 4096,
        timeout: 60000, // 60 秒超时
        configuration: {
          baseURL: baseUrl,
          defaultHeaders: provider.headers,
        },
      });

    case 'gemini':
      return new ChatGoogleGenerativeAI({
        apiKey: provider.apiKey,
        model: model,
        maxOutputTokens: 4096,
        // Gemini 不支持自定义 baseUrl，使用 Google 官方 API
      });

    default:
      throw new Error(`不支持的 Provider API 格式: ${provider.apiFormat}`);
  }
}

/**
 * 创建流式 ChatModel 实例
 * 所有支持的 Provider 都启用流式输出
 */
export function createStreamingChatModel(provider: ProviderConfig, model: string): BaseChatModel {
  const modelInstance = createChatModel(provider, model);

  // 设置流式模式 - 所有支持的 Provider
  if (modelInstance instanceof ChatOpenAI) {
    modelInstance.streaming = true;
  }

  // ChatAnthropic 默认支持流式，通过 callbacks 配置
  if (modelInstance instanceof ChatAnthropic) {
    // Anthropic SDK 默认就是流式的，LangChain wrapper 会正确处理
    // 无需额外配置，streaming 已内置
  }

  // ChatGoogleGenerativeAI 默认支持流式
  if (modelInstance instanceof ChatGoogleGenerativeAI) {
    // Gemini 默认就是流式的，无需额外配置
  }

  return modelInstance;
}

/**
 * 创建绑定了工具的 ChatModel 实例（原生 Function Calling）
 * 使用 LangChain 的 bindTools 方法绑定工具
 * 添加 tool_choice="required" 强制模型调用工具
 */
export function createChatModelWithTools(
  provider: ProviderConfig,
  model: string,
  tools: DynamicStructuredTool[]
): BaseChatModel {
  const modelInstance = createStreamingChatModel(provider, model);

  // 使用 bindTools 绑定工具，支持原生 Function Calling
  // 使用类型断言绕过 TypeScript 的可选方法检查
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundModel = (modelInstance as any);
  if (typeof boundModel.bindTools === 'function') {
    // 让模型自主决定是否调用工具
    // 使用 'auto' 而非 'required'，因为 'required' 会强制每次都调用工具
    // 即使是简单的问候语也会触发工具调用，影响用户体验
    console.log(`[Agent] Binding ${tools.length} tools for model ${model} (provider: ${provider.apiFormat})`);
    const toolNames = tools.map(t => t.name).slice(0, 5).join(', ');
    console.log(`[Agent] Tools bound: ${toolNames}${tools.length > 5 ? ` ... (+${tools.length - 5} more)` : ''}`);
    return boundModel.bindTools(tools, { tool_choice: 'auto' }) as BaseChatModel;
  }

  // 回退：记录警告，依赖文本解析
  console.warn(`[Agent] Model ${model} (provider: ${provider.apiFormat}) does not support bindTools, falling back to text parsing`);
  console.warn(`[Agent] Tools will be parsed from text output using regex patterns`);
  return modelInstance;
}

/**
 * 从消息chunk中提取文本内容
 */
function extractChunkContent(chunk: AIMessageChunk): string {
  const content = chunk.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 流式调用LLM，直接发送token级chunks
 * 绕过LangGraph节点内部的stream消费问题
 */
export interface StreamLlmOptions {
  provider: ProviderConfig;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  tools?: DynamicStructuredTool[];
  timeoutMs?: number;
  onToken: (token: string) => Promise<void> | void;
}

export interface StreamLlmResult {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}

/**
 * 分段超时控制：
 * - firstTokenTimeoutMs: 等待首个token的超时（连接/首token生成）
 * - chunkTimeoutMs: 等待后续chunk的超时（模型生成下一个token）
 * - totalTimeoutMs: 总超时限制，防止无限等待
 */
interface TimeoutConfig {
  firstTokenTimeoutMs: number;
  chunkTimeoutMs: number;
  totalTimeoutMs: number;
}

const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  firstTokenTimeoutMs: 30000, // 30秒等待首token（网络+模型首token时间）
  chunkTimeoutMs: 60000, // 60秒等待下一个chunk（模型生成时间）
  totalTimeoutMs: 300000, // 5分钟总超时
};

export async function streamLlmDirect(options: StreamLlmOptions): Promise<StreamLlmResult> {
  const { provider, model, messages, tools, timeoutMs = 300000, onToken } = options;

  // 根据总超时计算各阶段超时
  const effectiveTimeout = Math.max(timeoutMs, 60000); // 最小60秒
  const timeoutConfig: TimeoutConfig = {
    firstTokenTimeoutMs: Math.min(30000, effectiveTimeout * 0.1), // 首token超时：总超时的10%，最大30秒
    chunkTimeoutMs: Math.min(60000, effectiveTimeout * 0.2), // chunk超时：总超时的20%，最大60秒
    totalTimeoutMs: effectiveTimeout,
  };

  // 创建ChatModel
  let chatModel: BaseChatModel;
  if (tools && tools.length > 0) {
    chatModel = createChatModelWithTools(provider, model, tools);
  } else {
    chatModel = createStreamingChatModel(provider, model);
  }

  // 转换消息格式
  const lcMessages = messages.map((m) => {
    if (m.role === 'system') return new SystemMessage(m.content);
    if (m.role === 'assistant') return new AIMessage(m.content);
    return new HumanMessage(m.content);
  });

  // 分段超时管理
  const startTime = Date.now();
  let lastTokenTime = startTime;
  let chunksReceived = 0;

  const checkTotalTimeout = () => {
    if (Date.now() - startTime > timeoutConfig.totalTimeoutMs) {
      throw new Error(`LLM total timeout exceeded ${timeoutConfig.totalTimeoutMs}ms`);
    }
  };

  const checkChunkTimeout = () => {
    const chunkElapsed = Date.now() - lastTokenTime;
    if (chunksReceived > 0 && chunkElapsed > timeoutConfig.chunkTimeoutMs) {
      throw new Error(`LLM chunk timeout: no token received for ${chunkElapsed}ms after ${chunksReceived} chunks`);
    }
  };

  // 创建带超时的流式迭代器
  const streamIterable = await chatModel.stream(lcMessages);
  const iterator = streamIterable[Symbol.asyncIterator]();

  const chunks: string[] = [];
  let finalResponse: AIMessage | null = null;
  let isDone = false;

  while (!isDone) {
    checkTotalTimeout();

    // 每次迭代前检查chunk超时
    checkChunkTimeout();

    // 等待下一个chunk，设置首token或chunk超时
    const remainingTotal = timeoutConfig.totalTimeoutMs - (Date.now() - startTime);
    const waitTimeout = chunksReceived === 0
      ? Math.min(timeoutConfig.firstTokenTimeoutMs, remainingTotal)
      : Math.min(timeoutConfig.chunkTimeoutMs, remainingTotal);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(
          chunksReceived === 0
            ? `First token timeout after ${waitTimeout}ms`
            : `Chunk timeout after ${waitTimeout}ms (last chunk ${Date.now() - lastTokenTime}ms ago)`
        ));
      }, waitTimeout);
    });

    try {
      // 使用 Promise.race 等待下一个chunk或超时
      const result = await Promise.race([
        iterator.next(),
        timeoutPromise,
      ]);

      if (result.done) {
        isDone = true;
      } else {
        const chunk = result.value as AIMessageChunk;
        const token = extractChunkContent(chunk);
        if (token) {
          chunks.push(token);
          lastTokenTime = Date.now();
          chunksReceived++;
          // 实时发送token
          await onToken(token);
        }
        finalResponse = chunk as AIMessage;
      }
    } catch (error) {
      // 超时错误
      if (chunksReceived > 0) {
        // 已经收到了一些chunk，说明流还在继续，可能是模型生成慢
        // 不抛出错误，继续尝试接收
        console.warn(`[LLM] Chunk timeout but continuing: ${error instanceof Error ? error.message : 'unknown'}, received ${chunksReceived} chunks so far`);
        // 重置lastTokenTime，继续等待
        lastTokenTime = Date.now();
        continue;
      }
      throw error;
    }
  }

  const content = chunks.join('');

  // 提取tool_calls
  const toolCalls: StreamLlmResult['toolCalls'] = [];
  if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
    for (const tc of finalResponse.tool_calls) {
      toolCalls.push({
        id: tc.id || crypto.randomUUID(),
        name: tc.name,
        arguments: tc.args as Record<string, unknown>,
      });
    }
  }

  // 调试日志：查看 MiniMax 返回的完整结构
  console.log('[LLM] finalResponse tool_calls:', finalResponse?.tool_calls?.length ?? 0);
  console.log('[LLM] finalResponse additional_kwargs:', JSON.stringify(finalResponse?.additional_kwargs?.tool_calls ?? null).slice(0, 200));
  console.log('[LLM] content length:', content.length);

  return { content, toolCalls };
}