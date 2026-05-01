# use-local-llm

React hooks for streaming responses from local LLMs — **Ollama**, **LM Studio**, **llama.cpp**, and any OpenAI-compatible endpoint. Zero server required. Browser → localhost, directly.

[![npm version](https://img.shields.io/npm/v/use-local-llm.svg)](https://www.npmjs.com/package/use-local-llm)
[![npm downloads](https://img.shields.io/npm/dm/use-local-llm.svg)](https://www.npmjs.com/package/use-local-llm)
[![bundle size](https://img.shields.io/bundlephobia/minzip/use-local-llm)](https://bundlephobia.com/package/use-local-llm)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/npm/l/use-local-llm.svg)](https://github.com/pooyagolchian/use-local-llm/blob/main/LICENSE)

---

## Table of Contents

- [Why use-local-llm?](#why-use-local-llm)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Supported Backends](#supported-backends)
- [API Reference](#api-reference)
  - [useOllama](#useollamamodel-options)
  - [useLocalLLM](#uselocalllmoptions)
  - [useStreamCompletion](#usestreamcompletionoptions)
  - [useModelList](#usemodellistoptions)
- [Examples](#examples)
  - [Chat Interface](#chat-interface)
  - [Streaming Text Completion](#streaming-text-completion)
  - [Model Selector](#model-selector)
  - [Multi-turn Conversation with System Prompt](#multi-turn-conversation-with-system-prompt)
  - [Token-by-Token Rendering](#token-by-token-rendering)
  - [Using with LM Studio](#using-with-lm-studio)
  - [Using with llama.cpp](#using-with-llamacpp)
- [Advanced Usage](#advanced-usage)
  - [Direct Stream Access (Non-React)](#direct-stream-access-non-react)
  - [Custom Abort Handling](#custom-abort-handling)
  - [Backend Auto-Detection](#backend-auto-detection)
- [CORS Configuration](#cors-configuration)
- [TypeScript Reference](#typescript-reference)
- [Architecture](#architecture)
- [Comparison with Vercel AI SDK](#comparison-with-vercel-ai-sdk)
- [Contributing](#contributing)
- [License](#license)

---

## Why use-local-llm?

**The problem:** [Vercel AI SDK](https://sdk.vercel.ai) is the standard for AI in React — but it **requires server routes**. Its React hooks (`useChat`, `useCompletion`) POST to your API routes, which then call the LLM. This architecture makes it impossible to call `http://localhost:11434` directly from the browser.

If you're prototyping with **Ollama**, **LM Studio**, or **llama.cpp**, you don't need a server in between. You need one hook that talks directly to your local model.

**use-local-llm** gives you:
- **Direct browser → localhost** streaming — no server, no API routes
- **Multi-backend support** — Ollama, LM Studio, llama.cpp, any OpenAI-compatible endpoint
- **Full chat state management** — message history, abort, clear, error handling
- **Token-by-token streaming** — real-time text rendering with `onToken` callbacks
- **Zero runtime dependencies** — only a peer dependency on React
- **2.8 KB gzipped** — smaller than most icons

---

## Quick Start

```tsx
import { useOllama } from "use-local-llm";

function Chat() {
  const { messages, send, isStreaming } = useOllama("gemma3:1b");

  return (
    <div>
      {messages.map((m, i) => (
        <p key={i}>
          <strong>{m.role}:</strong> {m.content}
        </p>
      ))}
      <button
        onClick={() => send("Explain React hooks in one sentence")}
        disabled={isStreaming}
      >
        {isStreaming ? "Generating..." : "Ask"}
      </button>
    </div>
  );
}
```

**That's it.** Streaming, message history, abort — all handled in one hook call.

---

## Installation

```bash
npm install use-local-llm
```

```bash
yarn add use-local-llm
```

```bash
pnpm add use-local-llm
```

**Requirements:**
- React >= 17.0.0 (peer dependency)
- A local LLM runtime running (Ollama, LM Studio, or llama.cpp)

---

## Supported Backends

| Backend | Default Port | Auto-detected | Chat API | Completion API | Model List |
|---------|-------------|---------------|----------|----------------|------------|
| [Ollama](https://ollama.ai) | 11434 | ✅ | `/api/chat` | `/api/generate` | `/api/tags` |
| [LM Studio](https://lmstudio.ai) | 1234 | ✅ | `/v1/chat/completions` | `/v1/completions` | `/v1/models` |
| [llama.cpp](https://github.com/ggerganov/llama.cpp) | 8080 | ✅ | `/v1/chat/completions` | `/v1/completions` | `/v1/models` |
| Any OpenAI-compatible | custom | via `backend` prop | `/v1/chat/completions` | `/v1/completions` | `/v1/models` |

The backend is **auto-detected** from the port number. You can also set it explicitly with the `backend` option.

---

## API Reference

### `useOllama(model, options?)`

Zero-config chat hook for Ollama. The simplest way to start.

```tsx
const result = useOllama("gemma3:1b");
const result = useOllama("llama3.1:8b", { system: "Be concise.", temperature: 0.7 });
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `model` | `string` | ✅ | Ollama model name (e.g. `"gemma3:1b"`, `"llama3.1:8b"`, `"qwen2.5:latest"`) |
| `options` | `OllamaOptions` | — | Configuration options (see below) |

**OllamaOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `system` | `string` | — | System prompt to set model behavior |
| `temperature` | `number` | model default | Sampling temperature (0 = deterministic, 1 = creative) |
| `endpoint` | `string` | `"http://localhost:11434"` | Custom Ollama endpoint URL |
| `onToken` | `(token: string) => void` | — | Callback fired on each streamed token |
| `onResponse` | `(msg: ChatMessage) => void` | — | Callback fired when a complete response is received |
| `onError` | `(err: Error) => void` | — | Callback fired on error |

**Returns:** [`LocalLLMResult`](#locallmresult)

---

### `useLocalLLM(options)`

Full-featured chat hook supporting any local backend.

```tsx
const result = useLocalLLM({
  endpoint: "http://localhost:1234",
  model: "mistral-7b",
  system: "Answer concisely.",
});
```

**LocalLLMOptions:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `endpoint` | `string` | ✅ | — | Base URL of the LLM server |
| `model` | `string` | ✅ | — | Model name |
| `backend` | `Backend` | — | auto-detected | `"ollama"` \| `"lmstudio"` \| `"llamacpp"` \| `"openai-compatible"` |
| `system` | `string` | — | — | System prompt |
| `temperature` | `number` | — | model default | Sampling temperature |
| `onToken` | `(token: string) => void` | — | — | Called on each streamed token |
| `onResponse` | `(msg: ChatMessage) => void` | — | — | Called on complete response |
| `onError` | `(err: Error) => void` | — | — | Called on error |

<a id="locallmresult"></a>
**Returns: `LocalLLMResult`**

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `ChatMessage[]` | Full conversation history (user + assistant messages) |
| `send` | `(content: string) => void` | Send a user message and trigger streaming response |
| `isStreaming` | `boolean` | `true` while tokens are being generated |
| `isLoading` | `boolean` | `true` while the request is in-flight (before first token) |
| `abort` | `() => void` | Cancel the current generation immediately |
| `error` | `Error \| null` | The last error that occurred, or `null` |
| `clear` | `() => void` | Reset the entire conversation history |

---

### `useStreamCompletion(options)`

Low-level hook for text completions (non-chat) with manual start/stop control.

```tsx
const result = useStreamCompletion({
  endpoint: "http://localhost:11434",
  model: "gemma3:1b",
  prompt: "Write a haiku about TypeScript",
});
```

**StreamCompletionOptions:**

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `endpoint` | `string` | ✅ | — | Base URL of the LLM server |
| `model` | `string` | ✅ | — | Model name |
| `prompt` | `string` | ✅ | — | The text prompt to send |
| `backend` | `Backend` | — | auto-detected | Backend type |
| `autoFetch` | `boolean` | — | `false` | Auto-start streaming when prompt changes |
| `temperature` | `number` | — | model default | Sampling temperature |
| `onToken` | `(token: string) => void` | — | — | Called on each token |
| `onComplete` | `(text: string) => void` | — | — | Called with full text when done |
| `onError` | `(err: Error) => void` | — | — | Called on error |

**Returns: `StreamCompletionResult`**

| Property | Type | Description |
|----------|------|-------------|
| `text` | `string` | Accumulated full text so far |
| `tokens` | `string[]` | Array of individual tokens received |
| `isStreaming` | `boolean` | Whether the stream is currently active |
| `start` | `() => void` | Start (or restart) the stream |
| `abort` | `() => void` | Abort the current stream |
| `error` | `Error \| null` | Last error |

---

### `useModelList(options?)`

Discover available models on a local LLM runtime. Fetches automatically on mount.

```tsx
const result = useModelList(); // defaults to Ollama
const result = useModelList({ endpoint: "http://localhost:1234", backend: "lmstudio" });
```

**ModelListOptions:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `endpoint` | `string` | `"http://localhost:11434"` | Base URL of the LLM server |
| `backend` | `Backend` | auto-detected | Backend type |

**Returns: `ModelListResult`**

| Property | Type | Description |
|----------|------|-------------|
| `models` | `LocalModel[]` | Array of available models |
| `isLoading` | `boolean` | Whether the model list is loading |
| `error` | `Error \| null` | Last error |
| `refresh` | `() => void` | Re-fetch the model list |

**`LocalModel` shape:**

```ts
interface LocalModel {
  name: string;       // e.g. "gemma3:1b", "llama3.1:8b"
  size?: number;      // size in bytes
  modifiedAt?: string; // last modified timestamp
  digest?: string;     // model digest hash
}
```

---

## Examples

### Chat Interface

A complete chat UI with streaming, abort, and conversation management:

```tsx
import { useState } from "react";
import { useOllama } from "use-local-llm";

function ChatApp() {
  const [input, setInput] = useState("");
  const { messages, send, isStreaming, abort, clear, error } = useOllama(
    "gemma3:1b",
    {
      system: "You are a friendly assistant. Keep responses concise.",
      temperature: 0.7,
    }
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    send(input);
    setInput("");
  };

  return (
    <div>
      <div>
        {messages.map((msg, i) => (
          <div key={i} style={{ margin: "8px 0" }}>
            <strong>{msg.role === "user" ? "You" : "AI"}:</strong>
            <p>{msg.content}</p>
          </div>
        ))}
      </div>

      {error && <p style={{ color: "red" }}>Error: {error.message}</p>}

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          disabled={isStreaming}
        />
        <button type="submit" disabled={isStreaming || !input.trim()}>
          Send
        </button>
        {isStreaming && (
          <button type="button" onClick={abort}>
            Stop
          </button>
        )}
        <button type="button" onClick={clear}>
          Clear
        </button>
      </form>
    </div>
  );
}
```

### Streaming Text Completion

Generate text with manual start/stop control:

```tsx
import { useState } from "react";
import { useStreamCompletion } from "use-local-llm";

function TextGenerator() {
  const [prompt, setPrompt] = useState("Write a short poem about coding");
  const { text, isStreaming, start, abort, tokens } = useStreamCompletion({
    endpoint: "http://localhost:11434",
    model: "gemma3:1b",
    prompt,
  });

  return (
    <div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
      />
      <div>
        <button onClick={start} disabled={isStreaming}>
          Generate
        </button>
        <button onClick={abort} disabled={!isStreaming}>
          Stop
        </button>
      </div>
      <pre>{text}</pre>
      <small>{tokens.length} tokens generated</small>
    </div>
  );
}
```

### Model Selector

Let users pick from available models before chatting:

```tsx
import { useState } from "react";
import { useModelList, useOllama } from "use-local-llm";

function ModelSelector() {
  const { models, isLoading, refresh } = useModelList();
  const [selectedModel, setSelectedModel] = useState("gemma3:1b");
  const { messages, send, isStreaming } = useOllama(selectedModel);

  if (isLoading) return <p>Loading models...</p>;

  return (
    <div>
      <select
        value={selectedModel}
        onChange={(e) => setSelectedModel(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.name} value={m.name}>
            {m.name} {m.size ? `(${(m.size / 1e9).toFixed(1)} GB)` : ""}
          </option>
        ))}
      </select>
      <button onClick={refresh}>Refresh Models</button>

      {/* Chat UI */}
      {messages.map((msg, i) => (
        <p key={i}>
          <b>{msg.role}:</b> {msg.content}
        </p>
      ))}
      <button onClick={() => send("Hello!")} disabled={isStreaming}>
        Send
      </button>
    </div>
  );
}
```

### Multi-turn Conversation with System Prompt

Build a specialized assistant with persistent system instructions:

```tsx
import { useOllama } from "use-local-llm";

function CodeReviewer() {
  const { messages, send, isStreaming, clear } = useOllama("qwen2.5-coder:32b", {
    system: `You are an expert code reviewer. When given code:
1. Identify bugs and security issues
2. Suggest improvements
3. Rate code quality (1-10)
Keep responses structured and concise.`,
    temperature: 0.3,
  });

  const reviewCode = () => {
    send(`Review this code:
\`\`\`js
app.get('/user/:id', (req, res) => {
  const query = "SELECT * FROM users WHERE id = " + req.params.id;
  db.query(query, (err, result) => res.json(result));
});
\`\`\``);
  };

  return (
    <div>
      <button onClick={reviewCode} disabled={isStreaming}>Review Code</button>
      <button onClick={clear}>Clear</button>
      {messages.map((m, i) => (
        <div key={i}>
          <h4>{m.role}</h4>
          <pre>{m.content}</pre>
        </div>
      ))}
    </div>
  );
}
```

### Token-by-Token Rendering

Use the `onToken` callback for real-time effects:

```tsx
import { useState } from "react";
import { useOllama } from "use-local-llm";

function TypewriterChat() {
  const [tokenCount, setTokenCount] = useState(0);
  const [tokensPerSec, setTokensPerSec] = useState(0);
  const startTime = useState(() => ({ current: 0 }))[0];

  const { messages, send, isStreaming } = useOllama("gemma3:1b", {
    onToken: () => {
      if (startTime.current === 0) startTime.current = Date.now();
      setTokenCount((c) => c + 1);
      const elapsed = (Date.now() - startTime.current) / 1000;
      if (elapsed > 0) setTokensPerSec(Math.round(tokenCount / elapsed));
    },
    onResponse: () => {
      startTime.current = 0;
      setTokenCount(0);
    },
  });

  return (
    <div>
      {isStreaming && (
        <small>
          {tokenCount} tokens | {tokensPerSec} tok/s
        </small>
      )}
      {messages.map((m, i) => (
        <p key={i}>{m.content}</p>
      ))}
      <button onClick={() => send("Tell me a joke")} disabled={isStreaming}>
        Ask
      </button>
    </div>
  );
}
```

### Using with LM Studio

LM Studio runs an OpenAI-compatible server on port 1234:

```tsx
import { useLocalLLM } from "use-local-llm";

function LMStudioChat() {
  const { messages, send, isStreaming } = useLocalLLM({
    endpoint: "http://localhost:1234",
    // backend auto-detected as "lmstudio" from port
    model: "local-model", // Use the model name shown in LM Studio
    system: "You are a helpful assistant.",
  });

  return (
    <div>
      {messages.map((m, i) => (
        <p key={i}><b>{m.role}:</b> {m.content}</p>
      ))}
      <button onClick={() => send("Hello!")} disabled={isStreaming}>
        Send
      </button>
    </div>
  );
}
```

### Using with llama.cpp

llama.cpp's built-in server runs on port 8080:

```tsx
import { useLocalLLM } from "use-local-llm";

function LlamaCppChat() {
  const { messages, send, isStreaming } = useLocalLLM({
    endpoint: "http://localhost:8080",
    // backend auto-detected as "llamacpp" from port
    model: "default", // llama.cpp typically has one loaded model
    temperature: 0.8,
  });

  return (
    <div>
      {messages.map((m, i) => (
        <p key={i}><b>{m.role}:</b> {m.content}</p>
      ))}
      <button onClick={() => send("What is the meaning of life?")} disabled={isStreaming}>
        Ask
      </button>
    </div>
  );
}
```

---

## Advanced Usage

### Direct Stream Access (Non-React)

For Node.js scripts, CLI tools, or custom integrations, the streaming utilities are exported directly:

```ts
import { streamChat, streamGenerate } from "use-local-llm";

// Chat with message history
async function chat() {
  for await (const chunk of streamChat({
    endpoint: "http://localhost:11434",
    backend: "ollama",
    model: "gemma3:1b",
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "What are React hooks?" },
    ],
  })) {
    process.stdout.write(chunk.content);
  }
}

// Simple text generation
async function generate() {
  for await (const chunk of streamGenerate({
    endpoint: "http://localhost:11434",
    backend: "ollama",
    model: "gemma3:1b",
    prompt: "Explain TypeScript in one sentence.",
  })) {
    process.stdout.write(chunk.content);
  }
}
```

### Custom Abort Handling

Both `streamChat` and `streamGenerate` accept an `AbortSignal` for cancellation:

```ts
import { streamGenerate } from "use-local-llm";

const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  for await (const chunk of streamGenerate({
    endpoint: "http://localhost:11434",
    model: "gemma3:1b",
    prompt: "Write a very long essay...",
    signal: controller.signal,
  })) {
    process.stdout.write(chunk.content);
  }
} catch (err) {
  if (err.name === "AbortError") {
    console.log("\nGeneration cancelled.");
  }
}
```

### Backend Auto-Detection

The library auto-detects the backend from the port number:

```ts
import { detectBackend } from "use-local-llm";

detectBackend("http://localhost:11434"); // → "ollama"
detectBackend("http://localhost:1234");  // → "lmstudio"
detectBackend("http://localhost:8080");  // → "llamacpp"
detectBackend("http://myserver:9000");   // → "openai-compatible"
```

You can override auto-detection with the `backend` option on any hook.

### Endpoint Presets

```ts
import { ENDPOINTS, CHAT_PATHS, GENERATE_PATHS, MODEL_LIST_PATHS } from "use-local-llm";

ENDPOINTS.ollama;   // { url: "http://localhost:11434", backend: "ollama" }
ENDPOINTS.lmstudio; // { url: "http://localhost:1234", backend: "lmstudio" }
ENDPOINTS.llamacpp; // { url: "http://localhost:8080", backend: "llamacpp" }

CHAT_PATHS.ollama;            // "/api/chat"
CHAT_PATHS["openai-compatible"]; // "/v1/chat/completions"
```

---

## CORS Configuration

When calling local LLM servers from a browser, CORS must be enabled on the server:

### Ollama

Set the `OLLAMA_ORIGINS` environment variable before starting:

```bash
# macOS
OLLAMA_ORIGINS="*" ollama serve

# Or set persistently
launchctl setenv OLLAMA_ORIGINS "*"
```

### LM Studio

CORS is **enabled by default**. No configuration needed.

### llama.cpp

Start the server with the `--host` flag:

```bash
./server -m model.gguf --host 0.0.0.0 --port 8080
```

---

## TypeScript Reference

All types are exported for use in your application:

```ts
import type {
  // Core types
  Backend,            // "ollama" | "lmstudio" | "llamacpp" | "openai-compatible"
  ChatMessage,        // { role: "system" | "user" | "assistant", content: string }
  StreamChunk,        // { content: string, done: boolean, model?: string }
  EndpointConfig,     // { url: string, backend: Backend }
  LocalModel,         // { name, size?, modifiedAt?, digest? }

  // Hook options
  LocalLLMOptions,
  OllamaOptions,
  StreamCompletionOptions,
  ModelListOptions,

  // Hook return types
  LocalLLMResult,
  StreamCompletionResult,
  ModelListResult,
} from "use-local-llm";
```

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Your React App                │
│                                                 │
│  useOllama("gemma3:1b")                         │
│       │                                         │
│       ▼                                         │
│  useLocalLLM({ endpoint, model, ... })          │
│       │                                         │
│       ▼                                         │
│  streamChat() / streamGenerate()                │
│       │         async generators                │
│       ▼                                         │
│  parseStreamChunk()                             │
│       │         NDJSON + SSE parser              │
│       ▼                                         │
│  fetch() + ReadableStream                       │
└─────────┬───────────────────────────────────────┘
          │  HTTP (no server in between)
          ▼
┌─────────────────────┐
│  Ollama :11434      │
│  LM Studio :1234    │
│  llama.cpp :8080    │
└─────────────────────┘
```

**Key design decisions:**

1. **No server required** — hooks call `localhost` directly via `fetch()`
2. **Async generators** — `streamChat()` and `streamGenerate()` yield `StreamChunk` objects, making them composable and testable outside React
3. **AbortController** — every stream can be cancelled immediately; user-initiated aborts don't trigger error states
4. **Zero dependencies** — only React as a peer dependency; the entire package is 2.8 KB gzipped

---

## Comparison with Vercel AI SDK

| Feature | use-local-llm | Vercel AI SDK (`ai`) |
|---------|--------------|---------------------|
| Browser → localhost | ✅ Direct | ❌ Requires API route |
| Server required | ❌ None | ✅ Node.js server |
| Ollama support | ✅ Built-in | ⚠️ Via server provider |
| LM Studio support | ✅ Built-in | ⚠️ Via server provider |
| llama.cpp support | ✅ Built-in | ❌ Not officially supported |
| Multi-backend | ✅ Auto-detected | ⚠️ Manual server setup per provider |
| Bundle size | 2.8 KB gzip | ~50 KB+ |
| Cloud LLMs (OpenAI, etc.) | ❌ Local only | ✅ Full support |
| Production server features | ❌ Not the goal | ✅ Rate limiting, auth, etc. |

**When to use this library:** Prototyping, local development, privacy-sensitive apps, air-gapped environments, hackathons, dev tools.

**When to use Vercel AI SDK:** Production apps, cloud LLMs, apps requiring server-side auth, rate limiting, or logging.

---

## Tested Models

This library has been live-tested against these models on Ollama:

| Model | Status | Notes |
|-------|--------|-------|
| `gemma3:1b` | ✅ Verified | Fast responses, great for prototyping |
| `llama3.1:8b` | ✅ Available | Good general-purpose model |
| `qwen2.5:latest` | ✅ Available | Strong multilingual support |
| `qwen2.5-coder:32b` | ✅ Available | Best for code generation |
| `deepseek-r1:latest` | ✅ Available | Reasoning model |
| `deepseek-coder-v2:latest` | ✅ Available | Code-focused |

Any model available via `ollama list` will work. The library is model-agnostic.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Write tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Ensure TypeScript compiles (`npm run typecheck`)
6. Submit a pull request

### Development Setup

```bash
git clone https://github.com/pooyagolchian/use-local-llm.git
cd use-local-llm
npm install
npm run dev        # Watch mode
npm test           # Run tests
npm run typecheck  # Type check
npm run build      # Production build
```

### Live Testing

To run integration tests against a running Ollama instance:

```bash
npx tsx scripts/test-live.ts
```

---

## License

MIT © [Pooya Golchian](https://github.com/pooyagolchian)
