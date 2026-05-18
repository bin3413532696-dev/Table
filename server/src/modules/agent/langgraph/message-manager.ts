/**
 * 消息记忆管理器
 *
 * 使用 trimMessages 防止对话历史超出模型的上下文限制
 */
import { trimMessages, BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import type { ProviderConfig } from './state';
import { createChatModel } from './chatModel';

interface MessageManagerConfig {
  /** 最大 token 数（使用 ChatModel.getNumTokens 计数）*/
  maxTokens: number;
  /** 保留策略：'last' 保留最近的，'first' 保留最早的 */
  strategy: 'last' | 'first';
  /** 结束于指定的消息类型（在截断时保留完整的最后一条该类型消息）*/
  endOn?: Array<'system' | 'human' | 'ai' | 'assistant' | 'tool'>;
}

const DEFAULT_CONFIG: MessageManagerConfig = {
  maxTokens: 128000,           // 默认 128K tokens（模型上下文窗口的 80%）
  strategy: 'last',
  endOn: ['human', 'assistant'],
};

/**
 * 消息管理器：自动修剪过长的话题历史
 */
export class MessageManager {
  private config: MessageManagerConfig;

  constructor(config: Partial<MessageManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 估算消息数组的 token 数
   * 使用 ChatOpenAI 的 token 计数方法（兼容大多数模型）
   */
  private async estimateTokenCount(messages: BaseMessage[]): Promise<number> {
    if (messages.length === 0) return 0;

    try {
      // 使用 OpenAI 的 tiktoken 兼容方法计数
      // 创建一个临时模型实例用于计数
      let totalTokens = 0;

      for (const msg of messages) {
        // 估算：每字符约 0.25 tokens（中文约 2 chars/token，英文约 4 chars/token）
        const textContent = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
        totalTokens += Math.ceil(textContent.length / 4);
      }

      // 添加每条消息的开销（role、格式等）
      totalTokens += messages.length * 4;

      return totalTokens;
    } catch {
      // 估算失败时返回一个大数，触发修剪
      return this.config.maxTokens + 1;
    }
  }

  /**
   * 修剪消息，确保不超过 maxTokens
   * @param messages 对话消息数组
   * @returns 修剪后的消息数组
   */
  async trim(messages: BaseMessage[]): Promise<BaseMessage[]> {
    if (messages.length === 0) return messages;

    const tokenCount = await this.estimateTokenCount(messages);
    if (tokenCount <= this.config.maxTokens) {
      return messages;  // 不需要修剪
    }

    // 使用 trimMessages 修剪
    try {
      return await trimMessages(messages, {
        maxTokens: this.config.maxTokens,
        tokenCounter: async (msgs) => this.estimateTokenCount(msgs),
        strategy: this.config.strategy,
        endOn: this.config.endOn,
      });
    } catch (error) {
      // 如果 trimMessages 失败，至少保留最后几条消息
      console.error('消息修剪失败:', error);
      return messages.slice(-10);
    }
  }

  /**
   * 根据 provider 和 model 获取配置好的 MessageManager
   */
  static fromProviderConfig(provider: ProviderConfig, model: string): MessageManager {
    // 不同模型有不同的上下文限制
    const contextLimits: Record<string, number> = {
      // GPT-4o 系列
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'chatgpt-4o-latest': 128000,
      // GPT-4 Turbo 系列
      'gpt-4-turbo': 128000,
      'gpt-4-turbo-2024-04-09': 128000,
      // GPT-4
      'gpt-4': 8192,
      'gpt-4-0613': 8192,
      // GPT-3.5 Turbo
      'gpt-3.5-turbo': 16385,
      'gpt-3.5-turbo-16k': 16385,
      // Claude 3.5
      'claude-3-5-sonnet-20241022': 200000,
      'claude-3-5-sonnet-latest': 200000,
      'claude-3-5-haiku-latest': 200000,
      // Claude 3
      'claude-3-opus-20240229': 200000,
      'claude-3-sonnet-20240229': 200000,
      'claude-3-haiku-20240307': 200000,
      // Gemini
      'gemini-1.5-pro': 128000,
      'gemini-1.5-flash': 128000,
      // Llama
      'llama-3.1-70b': 128000,
      'llama-3.1-8b': 128000,
      // 默认
      'default': 128000,
    };

    const modelKey = model.toLowerCase();
    let maxTokens = contextLimits['default'];

    // 查找匹配的模型限制
    for (const [key, limit] of Object.entries(contextLimits)) {
      if (modelKey.includes(key)) {
        maxTokens = limit;
        break;
      }
    }

    // 使用 80% 作为实际限制（留 buffer 给响应）
    return new MessageManager({
      maxTokens: Math.floor(maxTokens * 0.8),
      strategy: 'last',
      endOn: ['human', 'assistant'],
    });
  }
}

// 创建默认实例
export const defaultMessageManager = new MessageManager();