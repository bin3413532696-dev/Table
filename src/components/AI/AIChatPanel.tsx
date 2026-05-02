import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { streamChat, OllamaMessage, ollamaClient } from '../../lib/ollama';
import { searchVectors } from '../../lib/vectorStore';
import { isLoaded } from '../../lib/embeddings';

interface AIChatPanelProps {
  notes?: Array<{ id: string; title: string; content: string }>;
  baseUrl?: string;
  model?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export default function AIChatPanel({ notes = [], baseUrl, model }: AIChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState(model || 'llama3.2');
  const [useSemanticSearch, setUseSemanticSearch] = useState(true);
  const [showConnectionHelp, setShowConnectionHelp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = useCallback(async () => {
    const healthy = await ollamaClient.checkHealth();
    setIsConnected(healthy);

    if (healthy) {
      const models = await ollamaClient.listModels();
      setAvailableModels(models);
      setShowConnectionHelp(false);
    } else {
      setShowConnectionHelp(true);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 获取相关上下文
  const getRelevantContext = useCallback(async (query: string): Promise<string> => {
    if (!notes.length) return '';

    // 如果启用了语义搜索且向量索引已就绪
    if (useSemanticSearch && isLoaded()) {
      try {
        const results = await searchVectors(query, 5);
        if (results.length > 0) {
          const contextNotes = results
            .map((r) => {
              const note = notes.find((n) => n.id === r.id);
              if (note) {
                return `## ${note.title}\n${note.content.slice(0, 800)}`;
              }
              return null;
            })
            .filter(Boolean)
            .join('\n\n');
          return contextNotes;
        }
      } catch (e) {
        console.warn('Semantic search failed, falling back to simple selection:', e);
      }
    }

    // 回退：使用简单的关键词匹配或取前几条
    const queryLower = query.toLowerCase();
    const relevantNotes = notes
      .filter((n) =>
        n.title.toLowerCase().includes(queryLower) ||
        n.content.toLowerCase().includes(queryLower)
      )
      .slice(0, 5);

    if (relevantNotes.length > 0) {
      return relevantNotes
        .map((n) => `## ${n.title}\n${n.content.slice(0, 500)}`)
        .join('\n\n');
    }

    // 最后回退：取前3条笔记
    return notes
      .slice(0, 3)
      .map((n) => `## ${n.title}\n${n.content.slice(0, 500)}`)
      .join('\n\n');
  }, [notes, useSemanticSearch]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    if (!isConnected) {
      setError('AI 服务未连接，请先启动 Ollama');
      setShowConnectionHelp(true);
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);
    setError(null);

    // 获取相关上下文
    const contextNotes = await getRelevantContext(userMessage.content);

    const systemPrompt = contextNotes
      ? `你是知识库助手。以下是与当前问题相关的笔记内容：

${contextNotes}

请基于以上内容回答用户的问题。如果笔记内容不足以回答问题，请根据你的知识给出回答，但要说明这不是来自知识库。`
      : '你是知识库助手，请根据用户的问题给出回答。';

    const allMessages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: userMessage.content },
    ];

    try {
      let fullResponse = '';

      if (typeof window !== 'undefined' && window.EventSource === undefined) {
        const response = await ollamaClient.chat(allMessages, selectedModel, (chunk) => {
          fullResponse += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: fullResponse }];
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: fullResponse,
                timestamp: Date.now(),
              },
            ];
          });
        });
      } else {
        for await (const chunk of streamChat(allMessages, selectedModel, baseUrl)) {
          fullResponse += chunk;
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: fullResponse }];
            }
            return [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: fullResponse,
                timestamp: Date.now(),
              },
            ];
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI 请求失败');
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, messages, selectedModel, baseUrl, getRelevantContext, isConnected]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex flex-col h-full bg-bg-card border border-border-primary rounded-lg">
      <div className="p-3 border-b border-border-primary flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">AI 助手</span>
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-success' : 'bg-error'}`}
            title={isConnected ? '已连接' : '未连接'}
          />
        </div>
        <div className="flex items-center gap-2">
          {isLoaded() && (
            <label className="flex items-center gap-1 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={useSemanticSearch}
                onChange={(e) => setUseSemanticSearch(e.target.checked)}
                className="w-3 h-3"
              />
              语义搜索
            </label>
          )}
          {availableModels.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="text-xs border border-border-primary rounded px-2 py-1 bg-bg-card"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* 连接帮助提示 */}
      {showConnectionHelp && (
        <div className="p-3 bg-warning-light dark:bg-warning/20 border-b border-border-primary">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-warning-dark dark:text-warning-400">AI 服务未连接</p>
              <p className="text-warning dark:text-warning-200 mt-1">
                请确保 Ollama 正在运行。启动方式：
              </p>
              <ol className="list-decimal list-inside mt-2 text-xs text-warning dark:text-warning-200 space-y-1">
                <li>安装 Ollama: <code className="bg-warning-light dark:bg-warning-dark px-1 rounded">ollama.ai</code></li>
                <li>启动服务: <code className="bg-warning-light dark:bg-warning-dark px-1 rounded">ollama serve</code></li>
                <li>下载模型: <code className="bg-warning-light dark:bg-warning-dark px-1 rounded">ollama pull llama3.2</code></li>
                <li>设置跨域: <code className="bg-warning-light dark:bg-warning-dark px-1 rounded">OLLAMA_ORIGINS=* ollama serve</code></li>
              </ol>
              <button
                onClick={checkConnection}
                className="mt-2 text-xs px-2 py-1 bg-warning text-white rounded hover:bg-warning-dark"
              >
                重新连接
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.length === 0 && !error && (
          <div className="text-center text-text-muted text-sm py-8">
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>开始对话吧！AI 可以帮助你分析笔记、回答问题。</p>
            {isLoaded() && (
              <p className="text-xs mt-2 text-text-muted">
                已启用语义搜索，AI 将自动找到相关笔记
              </p>
            )}
          </div>
        )}

        {error && !showConnectionHelp && (
          <div className="p-3 bg-error-light dark:bg-error/20 text-error dark:text-error-400 text-sm rounded-lg">
            {error}
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center ${
                message.role === 'user' ? 'bg-primary text-white' : 'bg-bg-tertiary'
              }`}
            >
              {message.role === 'user' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
            </div>
            <div
              className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                message.role === 'user'
                  ? 'bg-primary text-white'
                  : 'bg-bg-secondary text-text-primary'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {isStreaming && (
          <div className="flex gap-2">
            <div className="w-6 h-6 rounded-full bg-bg-tertiary flex items-center justify-center">
              <Bot className="w-3 h-3" />
            </div>
            <div className="bg-bg-secondary px-3 py-2 rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin text-text-muted" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 border-t border-border-primary">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isConnected ? "输入消息... (Enter 发送, Shift+Enter 换行)" : "AI 服务未连接..."}
            className="flex-1 resize-none border border-border-primary rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary bg-bg-card disabled:opacity-50"
            rows={2}
            disabled={!isConnected}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming || !isConnected}
            className="px-4 py-2 bg-primary text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}