import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, Loader2, AlertCircle, CheckCircle, XCircle, Square, ChevronDown, ChevronRight, Sparkles, CheckSquare, BookOpen, Wallet, Calendar, History, Plus, Trash2, Menu, X, Clock, Database } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgent } from '../../agent/AgentContext';
import { AgentMessage } from '../../agent/types';
import { useNavigate } from 'react-router-dom';
import { SessionMemoryCard } from '../../components/Agent';
import {
  fetchAgentSessionList,
  fetchAgentSessionDetail,
  deleteAgentSessionApi,
  createAgentSession,
  type AgentSessionDto,
} from '../../lib/agentApi';

// 快捷功能卡片配置
const quickActions = [
  { icon: CheckSquare, label: '创建任务', desc: '管理日常任务', path: '/tasks', color: 'primary' },
  { icon: BookOpen, label: '知识检索', desc: '搜索知识库', path: '/knowledge', color: 'success' },
  { icon: Wallet, label: '记录收支', desc: '财务统计', path: '/finance', color: 'warning' },
  { icon: Calendar, label: '工具集合', desc: '效率工具', path: '/tools', color: 'neutral' },
];

// 消息渲染组件
interface MessageItemProps {
  message: AgentMessage;
  streamingContent?: string;
  expandedToolCalls: Set<string>;
  toggleToolCallExpand: (id: string) => void;
}

const MessageItem = memo(function MessageItem({ message, streamingContent, expandedToolCalls, toggleToolCallExpand }: MessageItemProps) {
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
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-bg-tertiary">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}
      
      <div
        className={isUser
          ? 'max-w-[85%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] xl:max-w-[60%] px-4 py-3 rounded-2xl text-sm shadow-sm transition-shadow duration-200 bg-bg-card border border-border-primary text-text-primary'
          : 'max-w-[85%] sm:max-w-[80%] md:max-w-[70%] lg:max-w-[65%] xl:max-w-[60%] px-4 py-3 rounded-2xl text-sm shadow-sm transition-shadow duration-200 bg-bg-card border border-border-primary hover:shadow-md'
        }
      >
        <div className='prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-2'>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border-primary/30 space-y-2">
            {message.toolCalls.map((toolCall) => {
              const result = message.toolResults?.[toolCall.id];
              const isExpanded = expandedToolCalls.has(toolCall.id);
              return (
                <div key={toolCall.id} className="text-xs">
                  <button
                    onClick={() => toggleToolCallExpand(toolCall.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/15 transition-colors duration-150"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span className="font-medium">{toolCall.name}</span>
                    {result && (
                      <span className="ml-1">
                        {result.success ? <CheckCircle className="w-3 h-3 text-success" /> : <XCircle className="w-3 h-3 text-error" />}
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 p-2.5 bg-bg-tertiary/50 rounded-lg text-xs overflow-hidden"
                    >
                      <div className="text-text-muted mb-1.5 font-medium">参数:</div>
                      <pre className="text-text-secondary overflow-auto">{JSON.stringify(toolCall.arguments, null, 2)}</pre>
                      {result && (
                        <div className="mt-2 text-text-muted">
                          <div className="mb-1.5 font-medium">结果:</div>
                          <pre className="text-text-secondary overflow-auto">{JSON.stringify(result.data ?? result.error, null, 2)}</pre>
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
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm bg-primary text-white">
          <span className="text-sm font-semibold">U</span>
        </div>
      )}
    </motion.div>
  );
}, (prev, next) => {
  return prev.message.id === next.message.id
    && prev.message.content === next.message.content
    && prev.message.status === next.message.status
    && prev.streamingContent === next.streamingContent
    && prev.expandedToolCalls === next.expandedToolCalls;
});

// 格式化时间
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

// 获取会话预览文本
function getSessionPreview(session: AgentSessionDto): string {
  const lastRun = session.runs[session.runs.length - 1];
  if (!lastRun) return '空会话';
  return lastRun.inputText.slice(0, 40) + (lastRun.inputText.length > 40 ? '...' : '');
}

// 获取会话状态
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
  const [inputAreaHeight, setInputAreaHeight] = useState(88);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // 会话历史管理
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<AgentSessionDto[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const hasMessages = state.messages.length > 0;

  // 自动滚动控制
  const isAutoScrollRef = useRef(true);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // 检测用户是否主动滚动
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    isAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  // 自动滚动到底部
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }, []);

  // 组件挂载时：如果已有消息，滚动到底部
  useEffect(() => {
    if (hasMessages) {
      const timer = setTimeout(scrollToBottom, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  // 监听输入框区域高度变化，动态调整padding
  useEffect(() => {
    const updateInputHeight = () => {
      if (inputAreaRef.current) {
        const height = inputAreaRef.current.offsetHeight;
        setInputAreaHeight(height);
      }
    };

    // 立即更新并延迟再次更新，确保获取正确的高度
    updateInputHeight();
    const timer = setTimeout(updateInputHeight, 100);

    const resizeObserver = new ResizeObserver(() => {
      updateInputHeight();
      // 当高度变化时，如果用户没有向上滚动，保持滚动到底部
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

  // 消息或状态变化时滚动
  useEffect(() => {
    if (state.isProcessing || state.streamingContent) {
      if (isAutoScrollRef.current) {
        scrollToBottom();
        const timer = setInterval(scrollToBottom, 500);
        return () => clearInterval(timer);
      }
    }
  }, [state.isProcessing, state.streamingContent, hasMessages, scrollToBottom]);

  // 构建渲染消息列表
  const messagesToRender = useMemo(() => {
    return state.messages.map((message) => ({
      message,
      streamingContent: state.streamingContent?.messageId === message.id
        ? state.streamingContent.content
        : undefined,
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
    // 发送后再次确保滚动到底部和输入框高度更新
    setTimeout(() => {
      if (inputAreaRef.current) {
        const height = inputAreaRef.current.offsetHeight;
        setInputAreaHeight(height);
        scrollToBottom();
      }
    }, 150);
  }, [input, state.isProcessing, sendMessage, scrollToBottom]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 加载历史会话列表
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

  // 打开历史面板时加载
  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, loadHistory]);

  // 发送消息后刷新历史
  useEffect(() => {
    if (!state.isProcessing && showHistory) loadHistory();
  }, [state.isProcessing, showHistory, loadHistory]);

  // 切换会话
  const handleLoadSession = useCallback(async (sessionId: string) => {
    try {
      const detail = await fetchAgentSessionDetail(sessionId);
      loadHistorySession(detail);
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  }, [loadHistorySession]);

  // 删除会话
  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个会话吗？会话中的所有对话记录都将被删除。')) return;
    try {
      await deleteAgentSessionApi(sessionId);
      setHistorySessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (sessionId === state.currentSessionId) {
        handleNewSession();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, [state.currentSessionId]);

  // 新建会话
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
    <div className="h-full flex min-h-0 overflow-hidden relative">
      {/* 左侧会话历史面板 */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="h-full bg-bg-card dark:bg-dark-bg-card border-r border-border-primary dark:border-dark-border-primary flex flex-col shrink-0 overflow-hidden"
          >
            {/* Header */}
            <div className="p-3 border-b border-border-primary dark:border-dark-border-primary flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">会话历史</span>
              </div>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1.5 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg transition-colors"
                title="关闭"
              >
                <X className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
              </button>
            </div>

            {/* 新建按钮 */}
            <div className="p-3 shrink-0">
              <button
                onClick={handleNewSession}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                新建会话
              </button>
            </div>

            {/* 会话列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-text-muted dark:text-dark-text-muted" />
                </div>
              ) : historySessions.length === 0 ? (
                <div className="text-center py-8 text-text-muted dark:text-dark-text-muted text-sm">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>暂无会话记录</p>
                </div>
              ) : (
                historySessions.map((session) => {
                  const status = getSessionStatus(session);
                  const isActive = session.id === state.currentSessionId;
                  return (
                    <motion.div
                      key={session.id}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => handleLoadSession(session.id)}
                      className={isActive
                        ? 'group p-2.5 rounded-lg border cursor-pointer transition-all border-primary bg-primary/10'
                        : 'group p-2.5 rounded-lg border cursor-pointer transition-all border-border-primary hover:border-primary/50 hover:bg-bg-tertiary'
                      }
                    >
                      <div className="flex items-start gap-2">
                        <div className={status === 'completed'
                          ? 'w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-success/10 text-success'
                          : status === 'failed'
                          ? 'w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-error/10 text-error'
                          : 'w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-bg-tertiary text-text-secondary'
                        }>
                          {status === 'completed' ? <CheckCircle className="w-3 h-3" /> :
                           status === 'failed' ? <XCircle className="w-3 h-3" /> :
                           <Clock className="w-3 h-3" />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary truncate font-medium">
                            {session.title || getSessionPreview(session)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
                            <span>{session.runs.length} 条对话</span>
                            <span>{formatTime(session.updatedAt)}</span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-error/10 rounded transition-all"
                          title="删除"
                        >
                          <Trash2 className="w-3 h-3 text-error" />
                        </button>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* 顶部工具栏 */}
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 bg-bg-card border-b border-border-primary">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={showHistory
                ? 'p-2 rounded-lg transition-colors bg-primary/10 text-primary'
                : 'p-2 rounded-lg transition-colors hover:bg-bg-tertiary text-text-muted'
              }
              title="会话历史"
            >
              {showHistory ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            {!showHistory && (
              <button
                onClick={handleNewSession}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm hover:bg-primary-dark transition-colors"
              >
                <Plus className="w-4 h-4" />
                新建
              </button>
            )}
          </div>

          {/* 连接状态 */}
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className={state.isConnected ? 'w-2 h-2 rounded-full bg-success' : 'w-2 h-2 rounded-full bg-error animate-pulse'} />
            {state.isConnected ? '已连接' : '未连接'}
          </div>
        </div>

        {/* 消息区域 */}
        <div ref={scrollAreaRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto" style={{ overscrollBehavior: 'y contain', paddingBottom: `${inputAreaHeight + 32}px` }}>
          {!hasMessages ? (
            <div className="h-full flex items-center justify-center p-6">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
                className="text-center max-w-lg"
              >
                {/* AI 图标 */}
                <div className="relative inline-block mb-6">
                  <motion.div
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="w-20 h-20 rounded-2xl bg-primary flex items-center justify-center shadow-md relative z-10"
                  >
                    <Bot className="w-10 h-10 text-white" />
                  </motion.div>
                  <div className="absolute inset-0 rounded-2xl bg-primary/20 blur-xl -z-0" />
                </div>

                <h2 className="text-2xl font-bold text-text-primary mb-2">
                  您好，我是 AI 助手
                </h2>
                <p className="text-base text-text-muted mb-6">
                  可以帮您管理任务、记录财务、检索知识等
                </p>

                {/* 快捷功能卡片 */}
                <p className="text-sm font-medium text-text-secondary mb-4 text-left">快捷操作</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-6">
                  {quickActions.map((action, index) => {
                    const colorClasses = {
                      primary: 'bg-primary/10 text-primary hover:bg-primary/15',
                      success: 'bg-success/10 text-success hover:bg-success/15',
                      warning: 'bg-warning/10 text-warning hover:bg-warning/15',
                      neutral: 'bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/80',
                    };
                    return (
                      <motion.button
                        key={action.path}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 + index * 0.06 }}
                        whileHover={{ scale: 1.02, y: -2 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => navigate(action.path)}
                        className="flex items-center gap-3 p-3.5 bg-bg-card rounded-lg border border-border-primary shadow-sm hover:shadow-md transition-all duration-200 text-left"
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200 ${colorClasses[action.color as keyof typeof colorClasses]}`}>
                          <action.icon className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-text-primary">{action.label}</p>
                          <p className="text-xs text-text-muted truncate">{action.desc}</p>
                        </div>
                      </motion.button>
                    );
                  })}
                </div>

                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-xs text-text-muted/60"
                >
                  试着对我说点什么...
                </motion.p>
              </motion.div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto px-4 sm:px-8 lg:px-12 xl:px-16 space-y-6">
              <SessionMemoryCard
                memory={state.currentSessionMemory}
                onRefresh={() => refreshSessionMemory(undefined, { backgroundPoll: true })}
                onDelete={() => deleteSessionMemory()}
                onToggleDisabled={(disabled) => setSessionMemoryDisabled(disabled)}
              />

              {messagesToRender.map(({ message, streamingContent }, index) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1], delay: index === 0 ? 0 : 0 }}
                >
                  <MessageItem
                    message={message}
                    streamingContent={streamingContent}
                    expandedToolCalls={expandedToolCalls}
                    toggleToolCallExpand={toggleToolCallExpand}
                  />
                </motion.div>
              ))}

              {state.isProcessing && !state.streamingContent && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2.5 text-text-muted dark:text-dark-text-muted text-sm"
                >
                  <div className="relative">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <div className="absolute inset-0 w-4 h-4 animate-ping opacity-30">
                      <Loader2 className="w-4 h-4" />
                    </div>
                  </div>
                  <span className="font-medium">思考中...</span>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 确认操作栏 */}
        <AnimatePresence>
          {state.confirmationRequest && (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="fixed left-0 right-0 z-10 px-4 sm:px-6 py-3 border-t border-warning/20 bg-warning/5 backdrop-blur-md"
              style={{ bottom: `${inputAreaHeight}px` }}
            >
              <div className="max-w-3xl mx-auto flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-full bg-warning/10 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-4 h-4 text-warning" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-warning">确认操作</p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1 whitespace-pre-wrap leading-relaxed">{state.confirmationRequest.description}</p>
                  <div className="flex gap-2 mt-2.5">
                    <button
                      onClick={() => void confirmAction()}
                      disabled={state.isProcessing}
                      className="px-3.5 py-2 bg-warning text-white text-xs font-medium rounded-lg hover:bg-warning-dark disabled:opacity-50 transition-all duration-150 active:scale-95"
                    >
                      确认执行
                    </button>
                    <button
                      onClick={() => void rejectAction()}
                      className="px-3.5 py-2 border border-border-primary dark:border-dark-border-primary text-text-primary dark:text-dark-text-primary text-xs font-medium rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors duration-150"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 错误提示 */}
        {state.error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="px-4 sm:px-6 py-2.5 shrink-0 bg-error/10 border-t border-error/20 text-error text-xs text-center font-medium"
          >
            {state.error}
          </motion.div>
        )}

        {/* 输入区域 */}
        <div ref={inputAreaRef} className="fixed bottom-0 left-0 right-0 z-20 px-4 sm:px-6 lg:px-16 xl:px-32 py-4 bg-bg-card/80 backdrop-blur-xl border-t border-border-primary/50 shadow-[0_-4px_24px_rgba(0,0,0,0.06)]">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-end gap-3 p-1.5 bg-bg-secondary/60 rounded-2xl border border-border-primary/30 shadow-sm">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px';
                  setTimeout(() => {
                    if (inputAreaRef.current) {
                      const height = inputAreaRef.current.offsetHeight;
                      setInputAreaHeight(height);
                      if (isAutoScrollRef.current) {
                        scrollToBottom();
                      }
                    }
                  }, 50);
                }}
                onKeyDown={handleKeyDown}
                placeholder="试着对我说点什么..."
                className="flex-1 resize-none bg-transparent px-4 py-2.5 text-sm text-text-primary focus:outline-none placeholder:text-text-muted/50 transition-all duration-200"
                style={{ minHeight: '40px', maxHeight: '150px' }}
                disabled={!state.isConnected || state.isProcessing || !!state.confirmationRequest}
              />
              {state.isProcessing && (
                <motion.button
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.85, opacity: 0 }}
                  onClick={stopThinking}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-error/20 text-error bg-error/8 hover:bg-error/15 transition-all duration-200 text-sm"
                  title="中断"
                >
                  <Square className="w-4 h-4" />
                  <span className="hidden sm:inline">停止</span>
                </motion.button>
              )}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={toggleRag}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl transition-all duration-200 text-sm ${
                  state.ragEnabled
                    ? 'bg-success/15 text-success border border-success/25 shadow-[0_2px_8px_rgba(22,163,74,0.15)]'
                    : 'bg-bg-tertiary text-text-muted border border-border-primary/50 hover:border-border-secondary hover:text-text-secondary'
                }`}
                title={state.ragEnabled ? '知识库检索已开启，点击关闭' : '知识库检索已关闭，点击开启'}
              >
                <Database className="w-4 h-4" />
                <span className="text-xs font-medium">{state.ragEnabled ? '知识库开' : '知识库关'}</span>
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSend}
                disabled={!input.trim() || state.isProcessing || !state.isConnected || !!state.confirmationRequest}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-primary to-primary-dark text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-primary/25 active:shadow-md active:shadow-primary/15 transition-all duration-200"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline font-medium">发送</span>
              </motion.button>
            </div>
            {state.isProcessing && state.streamingContent && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 mt-2 text-xs text-text-muted/70"
              >
                <Sparkles className="w-3 h-3 animate-pulse text-primary/60" />
                <span>正在生成回复...</span>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
