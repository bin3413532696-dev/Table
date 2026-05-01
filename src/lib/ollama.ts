export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
}

export interface ChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream?: boolean;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';

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
    const modelToUse = model || this.defaultModel;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelToUse,
        messages,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            fullContent += parsed.message.content;
            onChunk?.(parsed.message.content);
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    }

    return fullContent;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];

      const data = await response.json();
      return (data.models || []).map((m: any) => m.name);
    } catch {
      return [];
    }
  }

  async checkHealth(): Promise<boolean> {
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
  baseUrl?: string
): AsyncGenerator<string> {
  const url = baseUrl || DEFAULT_BASE_URL;
  const modelToUse = model || DEFAULT_MODEL;

  const response = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelToUse,
      messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          yield parsed.message.content;
        }
      } catch {
        // Skip non-JSON lines
      }
    }
  }
}