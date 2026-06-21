import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Send,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  Square,
  ChevronDown,
  ChevronRight,
  Sparkles,
  CheckSquare,
  BookOpen,
  Wallet,
  Wrench,
  History,
  Plus,
  Trash2,
  Menu,
  X,
  Clock,
  Database,
  ArrowUpRight,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SessionMemoryCard, useAgent } from '../../agent/public';
import type { AgentMessage, AgentSessionDto } from '../../agent/public';
import { useNavigate } from 'react-router-dom';
import {
  fetchAgentSessionList,
  fetchAgentSessionDetail,
  deleteAgentSessionApi,
  createAgentSession,
} from '../../agent/public';

const suggestedPrompts = [
  '帮我整理今天最重要的三件事',
  '根据我的知识库总结最近上传的重点',
  '把我今天的工作拆成可执行任务',
];

const moduleShortcuts = [
  { icon: CheckSquare, label: '任务', desc: '进入任务管理', path: '/tasks' },
  { icon: BookOpen, label: '知识库', desc: '检索资料与笔记', path: '/knowledge' },
  { icon: Wallet, label: '财务', desc: '查看收支记录', path: '/finance' },
  { icon: Wrench, label: '工具', desc: '打开效率工具', path: '/tools' },
];

interface MessageItemProps {
  message: AgentMessage;
  streamingContent?: string;
  expandedToolCalls: Set<string>;
  toggleToolCallExpand: (id: string) => void;
}

const MessageItem = memo(function MessageItem({
  message,
  streamingContent,
  expandedToolCalls,
  toggleToolCallExpand,
}: MessageItemProps) {
  const isUser = message.role === 'user';
  const displayContent = streamingContent ?? message.content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className={isUser ? 'flex justify-end gap-3' : 'flex justify-start gap-3'}
    >
      {!isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 shadow-sm">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}

      <div
        className={
          isUser
            ? 'max-w-[88%] sm:max-w-[78%] lg:max-w-[68%] rounded-[24px] rounded-tr-md border border-primary/15 bg-primary/8 px-4 py-3 text-sm text-text-primary shadow-sm'
            : 'max-w-[88%] sm:max-w-[78%] lg:max-w-[68%] rounded-[24px] rounded-tl-md border border-border-primary bg-bg-card px-4 py-3 text-sm text-text-primary shadow-sm'
        }
      >
        <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-border-primary/40 pt-3">
            {message.toolCalls.map((toolCall) => {
              const result = message.toolResults?.[toolCall.id];
              const isExpanded = expandedToolCalls.has(toolCall.id);
              return (
                <div key={toolCall.id} className="text-xs">
                  <button
                    onClick={() => toggleToolCallExpand(toolCall.id)}
                    className="flex items-center gap-1.5 rounded-full bg-bg-secondary px-3 py-1.5 text-primary transition-colors duration-150 hover:bg-primary/10"
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span className="font-medium">{toolCall.name}</span>
                    {result && (
                      <span className="ml-1">
                        {result.success ? (
                          <CheckCircle className="h-3 w-3 text-success" />
                        ) : (
                          <XCircle className="h-3 w-3 text-error" />
                        )}
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 overflow-hidden rounded-2xl border border-border-primary bg-bg-secondary/70 p-3 text-xs"
                    >
                      <div className="mb-1.5 font-medium text-text-muted">参数</div>
                      <pre className="overflow-auto text-text-secondary">{JSON.stringify(toolCall.arguments, null, 2)}</pre>
                      {result && (
                        <div className="mt-3 text-text-muted">
                          <div className="mb-1.5 font-medium">结果</div>
                          <pre className="overflow-auto text-text-secondary">
                            {JSON.stringify(result.data ?? result.error, null, 2)}
                          </pre>
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isUser && (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-text-primary shadow-sm">
          <span className="text-sm font-semibold text-bg-card">U</span>
        </div>
      )}
    </motion.div>
  );
}, (prev, next) => {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.status === next.message.status &&
    prev.streamingContent === next.streamingContent &&
    prev.expandedToolCalls === next.expandedToolCalls
  );
});

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function getSessionPreview(session: AgentSessionDto): string {
  const lastRun = session.runs[session.runs.length - 1];
  if (!lastRun) return '空会话';
  return lastRun.inputText.slice(0, 40) + (lastRun.inputText.length > 40 ? '...' : '');
}

function getSessionStatus(session: AgentSessionDto): string {
  const lastRun = session.runs[session.runs.length - 1];
  if (!lastRun) return 'completed';
  return lastRun.status;
}

export default function Dashboard() {
  const {
    state,
    sendMessage,
    stopThinking,
    confirmAction,
    rejectAction,
    newSession,
    loadHistorySession,
    refreshSessionMemory,
    deleteSessionMemory,
    setSessionMemoryDisabled,
    toggleRag,
  } = useAgent();
  const [input, setInput] = useState('');
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());
  const [inputAreaHeight, setInputAreaHeight] = useState(96);
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<AgentSessionDto[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isAutoScrollRef = useRef(true);
  const navigate = useNavigate();

  const hasMessages = state.messages.length > 0;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    isAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, []);

  useEffect(() => {
    if (hasMessages) {
      const timer = setTimeout(scrollToBottom, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    const updateInputHeight = () => {
      if (inputAreaRef.current) {
        setInputAreaHeight(inputAreaRef.current.offsetHeight);
      }
    };

    updateInputHeight();
    const timer = setTimeout(updateInputHeight, 100);

    const resizeObserver = new ResizeObserver(() => {
      updateInputHeight();
      if (isAutoScrollRef.current) {
        scrollToBottom();
      }
    });

    if (inputAreaRef.current) {
      resizeObserver.observe(inputAreaRef.current);
    }

    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
    };
  }, [state.isProcessing, state.confirmationRequest, scrollToBottom]);

  useEffect(() => {
    if (state.isProcessing || state.streamingContent) {
      if (isAutoScrollRef.current) {
        scrollToBottom();
        const timer = setInterval(scrollToBottom, 500);
        return () => clearInterval(timer);
      }
    }
  }, [state.isProcessing, state.streamingContent, hasMessages, scrollToBottom]);

  const messagesToRender = useMemo(() => {
    return state.messages.map((message) => ({
      message,
      streamingContent:
        state.streamingContent?.messageId === message.id ? state.streamingContent.content : undefined,
    }));
  }, [state.messages, state.streamingContent]);

  const toggleToolCallExpand = useCallback((toolCallId: string) => {
    setExpandedToolCalls((prev) => {
      const next = new Set(prev);
      if (next.has(toolCallId)) next.delete(toolCallId);
      else next.add(toolCallId);
      return next;
    });
  }, []);

  const handleSend = useCallback(async () => {
    if (!input.trim() || state.isProcessing) return;
    const message = input.trim();
    setInput('');
    await sendMessage(message);
    inputRef.current?.focus();
    setTimeout(() => {
      if (inputAreaRef.current) {
        setInputAreaHeight(inputAreaRef.current.offsetHeight);
        scrollToBottom();
      }
    }, 150);
  }, [input, state.isProcessing, sendMessage, scrollToBottom]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleSuggestedPrompt = useCallback((prompt: string) => {
    setInput(prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const result = await fetchAgentSessionList({ limit: 20 });
      setHistorySessions(result.items);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (showHistory) {
      void loadHistory();
    }
  }, [showHistory, loadHistory]);

  useEffect(() => {
    if (!state.isProcessing && showHistory) {
      void loadHistory();
    }
  }, [state.isProcessing, showHistory, loadHistory]);

  const handleLoadSession = useCallback(
    async (sessionId: string) => {
      try {
        const detail = await fetchAgentSessionDetail(sessionId);
        loadHistorySession(detail);
        setShowHistory(false);
      } catch (error) {
        console.error('Failed to load session:', error);
      }
    },
    [loadHistorySession],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm('确定要删除这个会话吗？会话中的所有对话记录都将被删除。')) return;
      try {
        await deleteAgentSessionApi(sessionId);
        setHistorySessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (sessionId === state.currentSessionId) {
          void handleNewSession();
        }
      } catch (error) {
        console.error('Failed to delete session:', error);
      }
    },
    [state.currentSessionId],
  );

  const handleNewSession = useCallback(async () => {
    try {
      const newSessionData = await createAgentSession('新会话');
      newSession(newSessionData.id);
      await loadHistory();
      setShowHistory(false);
      inputRef.current?.focus();
    } catch (error) {
      console.error('Failed to create new session:', error);
    }
  }, [newSession, loadHistory]);

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-bg-secondary">
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.button
              type="button"
              aria-label="关闭历史面板"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="absolute inset-0 z-20 bg-black/20 backdrop-blur-[1px]"
            />
            <motion.aside
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
              className="absolute inset-y-0 left-0 z-30 flex w-full max-w-[320px] flex-col border-r border-border-primary bg-bg-card shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-border-primary px-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold text-text-primary">会话历史</h2>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">切换最近对话，或整理当前工作上下文</p>
                </div>
                <button
                  onClick={() => setShowHistory(false)}
                  className="rounded-xl border border-border-primary p-2 text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="border-b border-border-primary px-4 py-3">
                <button
                  onClick={() => void handleNewSession()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-3 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-tertiary"
                >
                  <Plus className="h-4 w-4" />
                  新建会话
                </button>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {isLoadingHistory ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
                  </div>
                ) : historySessions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border-primary bg-bg-secondary/70 px-4 py-8 text-center text-sm text-text-muted">
                    <History className="mx-auto mb-3 h-8 w-8 opacity-40" />
                    暂无会话记录
                  </div>
                ) : (
                  historySessions.map((session) => {
                    const status = getSessionStatus(session);
                    const isActive = session.id === state.currentSessionId;
                    return (
                      <motion.button
                        key={session.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => void handleLoadSession(session.id)}
                        className={
                          isActive
                            ? 'group w-full rounded-2xl border border-primary/30 bg-primary/10 p-3 text-left transition-all'
                            : 'group w-full rounded-2xl border border-border-primary bg-bg-card p-3 text-left transition-all hover:border-primary/30 hover:bg-bg-secondary'
                        }
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={
                              status === 'completed'
                                ? 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-success'
                                : status === 'failed'
                                  ? 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-error/10 text-error'
                                  : 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-secondary'
                            }
                          >
                            {status === 'completed' ? (
                              <CheckCircle className="h-3.5 w-3.5" />
                            ) : status === 'failed' ? (
                              <XCircle className="h-3.5 w-3.5" />
                            ) : (
                              <Clock className="h-3.5 w-3.5" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-text-primary">
                              {session.title || getSessionPreview(session)}
                            </p>
                            <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                              <span>{session.runs.length} 条对话</span>
                              <span>{formatTime(session.updatedAt)}</span>
                            </div>
                          </div>

                          <button
                            onClick={(e) => void handleDeleteSession(session.id, e)}
                            className="rounded-lg p-1 text-error opacity-0 transition-all group-hover:opacity-100 hover:bg-error/10"
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </motion.button>
                    );
                  })
                )}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-border-primary bg-bg-card">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <button
                onClick={() => setShowHistory((prev) => !prev)}
                className={
                  showHistory
                    ? 'rounded-xl border border-border-primary bg-bg-secondary p-2 text-text-primary transition-colors'
                    : 'rounded-xl border border-transparent p-2 text-text-muted transition-colors hover:border-border-primary hover:bg-bg-secondary hover:text-text-primary'
                }
                title="会话历史"
              >
                {showHistory ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-base font-semibold text-text-primary">智能体工作台</h1>
                  <span className="hidden rounded-full border border-border-primary bg-bg-secondary px-2 py-0.5 text-[11px] font-medium text-text-muted sm:inline-flex">
                    {hasMessages ? '进行中' : '新对话'}
                  </span>
                </div>
                <p className="hidden truncate text-xs text-text-muted sm:block">
                  从当前上下文继续工作，或开始一轮新的对话
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 rounded-xl border border-border-primary bg-bg-secondary px-3 py-2 text-sm text-text-muted sm:flex">
                <span
                  className={
                    state.isConnected
                      ? 'h-2 w-2 rounded-full bg-success'
                      : 'h-2 w-2 rounded-full bg-error animate-pulse'
                  }
                />
                {state.isConnected ? '已连接' : '未连接'}
              </div>

              <button
                onClick={() => void handleNewSession()}
                className="flex items-center gap-1.5 rounded-xl bg-text-primary px-3.5 py-2 text-sm font-medium text-bg-card transition-opacity hover:opacity-90"
              >
                <Plus className="h-4 w-4" />
                新建会话
              </button>
            </div>
          </div>
        </header>

        <div
          ref={scrollAreaRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto"
          style={{ overscrollBehavior: 'y contain', paddingBottom: `${inputAreaHeight + 40}px` }}
        >
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 pt-6 sm:px-6 lg:px-8">
            {!hasMessages ? (
              <div className="flex flex-1 items-center py-4">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                  className="w-full"
                  data-testid="dashboard-empty-state"
                >
                  <div className="mx-auto max-w-3xl rounded-[32px] border border-border-primary bg-bg-card px-6 py-8 shadow-sm sm:px-8 sm:py-10">
                    <div className="mb-8 flex items-start justify-between gap-6">
                      <div className="max-w-xl">
                        <div className="mb-4 inline-flex rounded-2xl border border-primary/15 bg-primary/10 p-3 text-primary">
                          <Bot className="h-7 w-7" />
                        </div>
                        <h2 className="text-3xl font-semibold text-text-primary">把当前工作直接交给 AI</h2>
                        <p className="mt-3 text-sm leading-6 text-text-secondary">
                          首页默认就是你的对话工作区。你可以让它整理任务、检索知识、归纳资料，或直接接着上一轮会话继续推进。
                        </p>
                      </div>

                      <div className="hidden rounded-2xl border border-border-primary bg-bg-secondary px-4 py-3 text-sm text-text-muted lg:block">
                        <div className="font-medium text-text-primary">建议起手</div>
                        <div className="mt-1">先说目标，再补充资料或限制条件</div>
                      </div>
                    </div>

                    <div className="mb-8">
                      <div className="mb-3 text-sm font-medium text-text-secondary">建议动作</div>
                      <div className="flex flex-wrap gap-2.5">
                        {suggestedPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            onClick={() => handleSuggestedPrompt(prompt)}
                            className="rounded-full border border-border-primary bg-bg-secondary px-4 py-2 text-sm text-text-primary transition-colors hover:border-primary/30 hover:bg-primary/5"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 text-sm font-medium text-text-secondary">快速进入模块</div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {moduleShortcuts.map((shortcut) => (
                          <button
                            key={shortcut.path}
                            onClick={() => navigate(shortcut.path)}
                            className="flex items-center gap-3 rounded-2xl border border-border-primary bg-bg-secondary/70 px-4 py-4 text-left transition-all hover:border-primary/25 hover:bg-bg-card hover:shadow-sm"
                          >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border-primary bg-bg-card text-text-primary">
                              <shortcut.icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-text-primary">{shortcut.label}</p>
                              <p className="text-xs text-text-muted">{shortcut.desc}</p>
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-text-muted" />
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-4xl space-y-6 py-2">
                <SessionMemoryCard
                  memory={state.currentSessionMemory}
                  onRefresh={() => refreshSessionMemory(undefined, { backgroundPoll: true })}
                  onDelete={() => deleteSessionMemory()}
                  onToggleDisabled={(disabled) => setSessionMemoryDisabled(disabled)}
                />

                {messagesToRender.map(({ message, streamingContent }) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    streamingContent={streamingContent}
                    expandedToolCalls={expandedToolCalls}
                    toggleToolCallExpand={toggleToolCallExpand}
                  />
                ))}

                {state.isProcessing && !state.streamingContent && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="flex items-center gap-2.5 rounded-2xl border border-border-primary bg-bg-card px-4 py-3 text-sm text-text-muted shadow-sm"
                  >
                    <div className="relative">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <div className="absolute inset-0 h-4 w-4 animate-ping opacity-30">
                        <Loader2 className="h-4 w-4" />
                      </div>
                    </div>
                    <span className="font-medium">思考中...</span>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {state.confirmationRequest && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="fixed left-0 right-0 z-10 px-4 py-3"
              style={{ bottom: `${inputAreaHeight}px` }}
            >
              <div className="mx-auto flex w-full max-w-4xl items-start gap-3 rounded-[24px] border border-warning/20 bg-warning/5 px-4 py-3 shadow-md backdrop-blur-sm">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/10">
                  <AlertCircle className="h-4 w-4 text-warning" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-warning">确认操作</p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-text-muted">
                    {state.confirmationRequest.description}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => void confirmAction()}
                      disabled={state.isProcessing}
                      className="rounded-xl bg-warning px-3.5 py-2 text-xs font-medium text-white transition-all duration-150 hover:bg-warning-dark disabled:opacity-50"
                    >
                      确认执行
                    </button>
                    <button
                      onClick={() => void rejectAction()}
                      className="rounded-xl border border-border-primary px-3.5 py-2 text-xs font-medium text-text-primary transition-colors duration-150 hover:bg-bg-tertiary"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {state.error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="shrink-0 border-t border-error/20 bg-error/10 px-4 py-2.5 text-center text-xs font-medium text-error"
          >
            {state.error}
          </motion.div>
        )}

        <div ref={inputAreaRef} className="fixed bottom-0 left-0 right-0 z-20 border-t border-border-primary bg-bg-card px-4 py-4 shadow-[0_-4px_18px_rgba(0,0,0,0.04)]">
          <div className="mx-auto w-full max-w-4xl">
            <div className="rounded-[28px] border border-border-primary bg-bg-secondary p-2 shadow-sm">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
                    setTimeout(() => {
                      if (inputAreaRef.current) {
                        setInputAreaHeight(inputAreaRef.current.offsetHeight);
                        if (isAutoScrollRef.current) {
                          scrollToBottom();
                        }
                      }
                    }, 50);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="描述你的目标、资料来源，或下一步要处理的事情..."
                  className="min-h-[48px] max-h-[150px] flex-1 resize-none bg-transparent px-4 py-3 text-sm text-text-primary outline-none placeholder:text-text-muted/60"
                  disabled={!state.isConnected || state.isProcessing || !!state.confirmationRequest}
                />

                <div className="flex shrink-0 items-center gap-2">
                  {state.isProcessing && (
                    <motion.button
                      initial={{ scale: 0.85, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.85, opacity: 0 }}
                      onClick={stopThinking}
                      className="flex items-center gap-1.5 rounded-2xl border border-error/20 bg-error/8 px-3 py-3 text-sm text-error transition-all duration-200 hover:bg-error/15"
                      title="中断"
                    >
                      <Square className="h-4 w-4" />
                      <span className="hidden sm:inline">停止</span>
                    </motion.button>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={toggleRag}
                    className={`flex items-center gap-1.5 rounded-2xl px-3 py-3 text-sm transition-all duration-200 ${
                      state.ragEnabled
                        ? 'border border-success/25 bg-success/12 text-success'
                        : 'border border-border-primary bg-bg-card text-text-muted hover:border-border-secondary hover:text-text-secondary'
                    }`}
                    title={state.ragEnabled ? '知识库检索已开启，点击关闭' : '知识库检索已关闭，点击开启'}
                  >
                    <Database className="h-4 w-4" />
                    <span className="hidden sm:inline text-xs font-medium">{state.ragEnabled ? '知识库开' : '知识库关'}</span>
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || state.isProcessing || !state.isConnected || !!state.confirmationRequest}
                    className="flex items-center gap-1.5 rounded-2xl bg-primary px-4 py-3 text-white transition-colors duration-200 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                    <span className="hidden sm:inline font-medium">发送</span>
                  </motion.button>
                </div>
              </div>
            </div>

            {state.isProcessing && state.streamingContent && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 flex items-center gap-2 text-xs text-text-muted/70"
              >
                <Sparkles className="h-3 w-3 animate-pulse text-primary/60" />
                <span>正在生成回复...</span>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
