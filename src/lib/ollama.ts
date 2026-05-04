import { ApiProvider, getActiveApiConfig } from './apiConfig';

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
}

export interface StreamChatOptions {
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const PROVIDER_STREAM_FIRST_CHUNK_TIMEOUT_MS = 8000;
const PROVIDER_CHAT_RETRY_COUNT = 2;
const PROVIDER_CHAT_RETRY_DELAY_MS = 1200;

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function buildProviderHeaders(config: ApiProvider): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(config.headers || {}),
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };
}

function getProviderChatUrl(config: ApiProvider): string {
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  switch (config.apiFormat) {
    case 'openai':
    case 'custom':
      return `${baseUrl}/chat/completions`;
    case 'anthropic':
      return `${baseUrl}/messages`;
    case 'gemini':
      return `${baseUrl}/models/${config.model || 'gemini-pro'}:generateContent`;
    default:
      return `${baseUrl}/chat/completions`;
  }
}

function getProviderModelsUrl(config: ApiProvider): string {
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  switch (config.apiFormat) {
    case 'openai':
    case 'custom':
      return `${baseUrl}/models`;
    case 'anthropic':
      return `${baseUrl}/models`;
    case 'gemini':
      return `${baseUrl}/models`;
    default:
      return `${baseUrl}/models`;
  }
}

function buildProviderRequestBody(
  config: ApiProvider,
  messages: OllamaMessage[],
  model: string,
  stream: boolean
): Record<string, unknown> {
  switch (config.apiFormat) {
    case 'anthropic':
      return {
        model,
        max_tokens: 4096,
        stream,
        messages: messages
          .filter((message) => message.role !== 'system')
          .map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
          })),
        system: messages.find((message) => message.role === 'system')?.content,
      };
    case 'gemini':
      return {
        contents: messages.map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          maxOutputTokens: 4096,
        },
      };
    case 'openai':
    case 'custom':
    default:
      return {
        model,
        messages,
        stream,
      };
  }
}

function extractTextFromPayload(config: ApiProvider, payload: any): string {
  switch (config.apiFormat) {
    case 'anthropic':
      if (payload?.type === 'content_block_delta') {
        return payload.delta?.text || '';
      }
      if (Array.isArray(payload?.content)) {
        return payload.content
          .map((item: any) => item?.text || '')
          .join('');
      }
      return '';
    case 'gemini':
      return payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('') || '';
    case 'openai':
    case 'custom':
    default:
      return payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || '';
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('provider error: 5') || message.includes('server disconnected');
}

async function fetchProviderResponse(
  config: ApiProvider,
  messages: OllamaMessage[],
  model: string,
  stream: boolean,
  signal?: AbortSignal
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= PROVIDER_CHAT_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(getProviderChatUrl(config), {
        method: 'POST',
        headers: buildProviderHeaders(config),
        body: JSON.stringify(buildProviderRequestBody(config, messages, model, stream)),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Provider error: ${response.status} ${errorText || response.statusText}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (signal?.aborted || !isRetryableProviderError(error) || attempt === PROVIDER_CHAT_RETRY_COUNT) {
        throw error;
      }

      await sleep(PROVIDER_CHAT_RETRY_DELAY_MS * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Provider request failed');
}

async function fetchProviderCompletion(
  config: ApiProvider,
  messages: OllamaMessage[],
  model: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetchProviderResponse(config, messages, model, false, signal);
  const payload = await response.json();
  return extractTextFromPayload(config, payload);
}

async function* streamFromProvider(
  config: ApiProvider,
  messages: OllamaMessage[],
  model: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const abortStream = () => {
    controller.abort(signal?.reason);
    void reader?.cancel(signal?.reason).catch(() => {
      // Ignore reader cancellation failures during abort.
    });
  };

  if (signal) {
    if (signal.aborted) {
      abortStream();
    } else {
      signal.addEventListener('abort', abortStream, { once: true });
    }
  }

  const response = await fetchProviderResponse(config, messages, model, true, controller.signal);

  reader = response.body?.getReader() || null;
  if (!reader) {
    throw new Error('No response body');
  }

  if (signal?.aborted) {
    abortStream();
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let receivedAnyChunk = false;
  let firstChunkTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    controller.abort(new Error('Provider stream first chunk timeout'));
  }, PROVIDER_STREAM_FIRST_CHUNK_TIMEOUT_MS);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!receivedAnyChunk) {
        receivedAnyChunk = true;
        if (firstChunkTimeout) {
          clearTimeout(firstChunkTimeout);
          firstChunkTimeout = null;
        }
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        const dataLine = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!dataLine || dataLine === '[DONE]') {
          continue;
        }

        try {
          const payload = JSON.parse(dataLine);
          const text = extractTextFromPayload(config, payload);
          if (text) {
            yield text;
          }
        } catch {
          // Ignore non-JSON stream fragments.
        }
      }
    }

    const tail = buffer.trim();
    if (tail && tail !== '[DONE]') {
      const dataLine = tail.startsWith('data:') ? tail.slice(5).trim() : tail;
      if (dataLine && dataLine !== '[DONE]') {
        try {
          const payload = JSON.parse(dataLine);
          const text = extractTextFromPayload(config, payload);
          if (text) {
            yield text;
          }
        } catch {
          // Ignore trailing invalid chunk.
        }
      }
    }
  } catch (error) {
    const shouldFallback =
      error instanceof DOMException && error.name === 'AbortError' && !receivedAnyChunk;

    if (!shouldFallback) {
      throw error;
    }

    const completion = await fetchProviderCompletion(config, messages, model, signal);
    if (completion) {
      yield completion;
    }
  } finally {
    if (firstChunkTimeout) {
      clearTimeout(firstChunkTimeout);
    }
    if (signal) {
      signal.removeEventListener('abort', abortStream);
    }
  }
}

async function fetchProviderModels(config: ApiProvider): Promise<string[]> {
  try {
    const response = await fetch(getProviderModelsUrl(config), {
      headers: buildProviderHeaders(config),
    });

    if (!response.ok) {
      return config.model ? [config.model] : [];
    }

    const data = await response.json();

    if ((config.apiFormat === 'openai' || config.apiFormat === 'custom' || config.apiFormat === 'anthropic') && Array.isArray(data?.data)) {
      const ids = data.data.map((item: any) => item?.id).filter(Boolean);
      return ids.length > 0 ? ids : (config.model ? [config.model] : []);
    }

    if (config.apiFormat === 'gemini' && Array.isArray(data?.models)) {
      const ids = data.models
        .map((item: any) => String(item?.name || '').replace(/^models\//, ''))
        .filter(Boolean);
      return ids.length > 0 ? ids : (config.model ? [config.model] : []);
    }

    return config.model ? [config.model] : [];
  } catch {
    return config.model ? [config.model] : [];
  }
}

export class OllamaClient {
  private baseUrl: string;
  private defaultModel: string;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.defaultModel = options.model || DEFAULT_MODEL;
  }

  async chat(
    messages: OllamaMessage[],
    model?: string,
    onChunk?: (content: string) => void
  ): Promise<string> {
    let fullContent = '';

    for await (const chunk of streamChat(messages, model, this.baseUrl)) {
      fullContent += chunk;
      onChunk?.(chunk);
    }

    return fullContent;
  }

  async listModels(): Promise<string[]> {
    const activeConfig = getActiveApiConfig();
    if (activeConfig) {
      return fetchProviderModels(activeConfig);
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.models || []).map((model: any) => model.name);
    } catch {
      return [];
    }
  }

  async checkHealth(): Promise<boolean> {
    const activeConfig = getActiveApiConfig();
    if (activeConfig) {
      try {
        const response = await fetch(getProviderModelsUrl(activeConfig), {
          headers: buildProviderHeaders(activeConfig),
        });
        if (response.ok) {
          return true;
        }

        // Some OpenAI-compatible providers support chat endpoints but do not
        // reliably expose a models endpoint to browsers. In that case keep the
        // agent available and rely on the configured model.
        return Boolean(activeConfig.baseUrl && activeConfig.model);
      } catch {
        return Boolean(activeConfig.baseUrl && activeConfig.model);
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const ollamaClient = new OllamaClient();

export async function* streamChat(
  messages: OllamaMessage[],
  model?: string,
  baseUrl?: string,
  options: StreamChatOptions = {}
): AsyncGenerator<string> {
  const activeConfig = getActiveApiConfig();
  const modelToUse = model || activeConfig?.model || DEFAULT_MODEL;

  if (activeConfig) {
    yield* streamFromProvider(activeConfig, messages, modelToUse, options.signal);
    return;
  }

  const url = normalizeBaseUrl(baseUrl || DEFAULT_BASE_URL);
  const response = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      model: modelToUse,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  let reader = response.body?.getReader() || null;
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  const abortStream = () => {
    void reader?.cancel(options.signal?.reason).catch(() => {
      // Ignore reader cancellation failures during abort.
    });
  };

  if (options.signal) {
    if (options.signal.aborted) {
      abortStream();
    } else {
      options.signal.addEventListener('abort', abortStream, { once: true });
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield parsed.message.content;
          }
        } catch {
          // Ignore invalid JSON lines.
        }
      }
    }
  } finally {
    if (options.signal) {
      options.signal.removeEventListener('abort', abortStream);
    }
  }
}
