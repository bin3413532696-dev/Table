import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import { streamChat, OllamaMessage, ollamaClient } from '../../lib/ollama';

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
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

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

    const contextNotes = notes
      .slice(0, 5)
      .map((n) => `## ${n.title}\n${n.content.slice(0, 500)}`)
      .join('\n\n');

    const systemPrompt = contextNotes
      ? `你是知识库助手。以下是与当前知识库相关的内容：\n${contextNotes}\n\n请基于以上内容回答用户的问题。`
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
  }, [input, isStreaming, messages, notes, selectedModel, baseUrl]);

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
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
        </div>
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

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.length === 0 && !error && (
          <div className="text-center text-text-muted text-sm py-8">
            <Bot className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>开始对话吧！AI 可以帮助你分析笔记、回答问题。</p>
          </div>
        )}

        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-sm rounded-lg">
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
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            className="flex-1 resize-none border border-border-primary rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary bg-bg-card"
            rows={2}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="px-4 py-2 bg-primary text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}