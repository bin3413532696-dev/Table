// =====================================================
// Embedding 模型抽象层
// 支持多种 Embedding 提供商的统一接口
// =====================================================

import { ragConfig } from '../config';

/**
 * Embedding 提供商类型
 */
export type EmbeddingProviderType = 'openai' | 'anthropic' | 'cohere' | 'local' | 'custom';

/**
 * Embedding 模型配置
 */
export interface EmbeddingModelConfig {
  /** 提供商类型 */
  provider: EmbeddingProviderType;
  /** API Key */
  apiKey: string;
  /** API Base URL（用于自定义端点或本地服务） */
  baseUrl?: string;
  /** 模型名称 */
  model: string;
  /** 向量维度 */
  dimensions: number;
  /** 批处理大小限制 */
  maxBatchSize?: number;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * Embedding 结果
 */
export interface EmbeddingResult {
  /** 向量数据 */
  embedding: number[];
  /** 模型名称 */
  model: string;
  /** 维度 */
  dimensions: number;
  /** Token 使用量（可选） */
  tokenUsage?: { total: number };
}

/**
 * Embedding 生成器抽象接口
 */
export interface IEmbeddingGenerator {
  /** 生成单个文本的 embedding */
  embedSingle(text: string): Promise<EmbeddingResult>;
  /** 批量生成多个文本的 embedding */
  embedBatch(texts: string[]): Promise<EmbeddingResult[]>;
  /** 获取模型信息 */
  getModelInfo(): { model: string; dimensions: number; provider: string };
}

// =====================================================
// OpenAI 兼容 Embedding 生成器
// =====================================================

import { OpenAIEmbeddings } from '@langchain/openai';

export class OpenAICompatibleEmbedder implements IEmbeddingGenerator {
  private embeddings: OpenAIEmbeddings;
  private config: EmbeddingModelConfig;

  constructor(config: EmbeddingModelConfig) {
    this.config = config;
    this.embeddings = new OpenAIEmbeddings({
      model: config.model,
      dimensions: config.dimensions,
      apiKey: config.apiKey,
      configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeoutMs ?? 60000,
    });
  }

  async embedSingle(text: string): Promise<EmbeddingResult> {
    const embedding = await this.embeddings.embedQuery(text);
    return {
      embedding,
      model: this.config.model,
      dimensions: embedding.length,
    };
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const embeddings = await this.embeddings.embedDocuments(texts);
    return embeddings.map((emb) => ({
      embedding: emb,
      model: this.config.model,
      dimensions: emb.length,
    }));
  }

  getModelInfo() {
    return {
      model: this.config.model,
      dimensions: this.config.dimensions,
      provider: this.config.provider,
    };
  }
}

// =====================================================
// 本地 Embedding 生成器（支持 Ollama 等本地服务）
// =====================================================

interface OllamaResponse {
  embeddings?: number[][];
  embedding?: number[];
}

export class LocalEmbedder implements IEmbeddingGenerator {
  private config: EmbeddingModelConfig;
  private baseUrl: string;

  constructor(config: EmbeddingModelConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async embedSingle(text: string): Promise<EmbeddingResult> {
    const results = await this.callLocalApi([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return this.callLocalApi(texts);
  }

  private async callLocalApi(texts: string[]): Promise<EmbeddingResult[]> {
    // Ollama API 格式
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      throw new Error(`本地 Embedding API 失败: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as OllamaResponse;

    // Ollama 返回格式适配
    if (data.embeddings) {
      return data.embeddings.map((emb) => ({
        embedding: emb,
        model: this.config.model,
        dimensions: emb.length,
      }));
    }

    // 单条返回格式
    if (data.embedding) {
      return [{
        embedding: data.embedding,
        model: this.config.model,
        dimensions: data.embedding.length,
      }];
    }

    throw new Error('本地 Embedding API 返回格式无效');
  }

  getModelInfo() {
    return {
      model: this.config.model,
      dimensions: this.config.dimensions,
      provider: 'local',
    };
  }
}

// =====================================================
// 自定义 HTTP Embedding 生成器
// =====================================================

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding: number[] }>;
  usage?: { total_tokens: number };
}

export class CustomHttpEmbedder implements IEmbeddingGenerator {
  private config: EmbeddingModelConfig;

  constructor(config: EmbeddingModelConfig) {
    this.config = config;
  }

  async embedSingle(text: string): Promise<EmbeddingResult> {
    const results = await this.callCustomApi([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return this.callCustomApi(texts);
  }

  private async callCustomApi(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.config.baseUrl) {
      throw new Error('自定义 Embedding 需要配置 baseUrl');
    }

    const response = await fetch(`${this.config.baseUrl}/v1/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.model,
        input: texts,
        dimensions: this.config.dimensions,
      }),
    });

    if (!response.ok) {
      throw new Error(`自定义 Embedding API 失败: ${response.status}`);
    }

    const data = await response.json() as OpenAIEmbeddingResponse;

    // OpenAI 格式适配
    if (data.data && Array.isArray(data.data)) {
      return data.data.map((item) => ({
        embedding: item.embedding,
        model: this.config.model,
        dimensions: item.embedding.length,
        tokenUsage: data.usage ? { total: data.usage.total_tokens } : undefined,
      }));
    }

    throw new Error('自定义 Embedding API 返回格式无效');
  }

  getModelInfo() {
    return {
      model: this.config.model,
      dimensions: this.config.dimensions,
      provider: 'custom',
    };
  }
}

// =====================================================
// Embedding 工厂函数
// =====================================================

/**
 * 根据配置创建 Embedding 生成器
 */
export function createEmbeddingGenerator(config: EmbeddingModelConfig): IEmbeddingGenerator {
  switch (config.provider) {
    case 'openai':
    case 'anthropic':
    case 'cohere':
      // 使用 OpenAI 兼容接口（大多数提供商支持）
      return new OpenAICompatibleEmbedder(config);

    case 'local':
      return new LocalEmbedder(config);

    case 'custom':
      return new CustomHttpEmbedder(config);

    default:
      // 默认使用 OpenAI 兼容
      return new OpenAICompatibleEmbedder(config);
  }
}

/**
 * 从 Provider 设置创建 Embedding 配置
 */
export function embeddingConfigFromProvider(
  apiKey: string,
  baseUrl?: string,
  model?: string,
  providerType?: string
): EmbeddingModelConfig {
  return {
    provider: (providerType as EmbeddingProviderType) || 'openai',
    apiKey,
    baseUrl,
    model: model || ragConfig.EMBEDDING_MODEL,
    dimensions: ragConfig.EMBEDDING_DIMENSIONS,
    timeoutMs: ragConfig.EMBEDDING_TIMEOUT_MS,
    maxRetries: ragConfig.EMBEDDING_MAX_RETRIES,
  };
}

// =====================================================
// 预定义模型配置
// =====================================================

export const PREDEFINED_EMBEDDING_MODELS: Record<string, {
  dimensions: number;
  maxDimensions?: number;
  minDimensions?: number;
  provider: string;
}> = {
  'text-embedding-3-small': {
    dimensions: 1536,
    maxDimensions: 1536,
    minDimensions: 256,
    provider: 'openai',
  },
  'text-embedding-3-large': {
    dimensions: 3072,
    maxDimensions: 3072,
    minDimensions: 256,
    provider: 'openai',
  },
  'bge-m3': {
    dimensions: 1024,
    provider: 'local',
  },
  'bge-large-en-v1.5': {
    dimensions: 1024,
    provider: 'local',
  },
  'nomic-embed-text': {
    dimensions: 768,
    provider: 'local',
  },
  'embed-multilingual-v3.0': {
    dimensions: 1024,
    provider: 'cohere',
  },
};

/**
 * 验证模型配置
 */
export function validateEmbeddingConfig(model: string, dimensions: number): boolean {
  const predefined = PREDEFINED_EMBEDDING_MODELS[model];

  if (predefined) {
    const minDim = predefined.minDimensions ?? predefined.dimensions;
    const maxDim = predefined.maxDimensions ?? predefined.dimensions;
    return dimensions >= minDim && dimensions <= maxDim;
  }

  // 未预定义的模型，允许自定义维度
  return dimensions > 0 && dimensions <= 4096; // pgvector 常见上限
}