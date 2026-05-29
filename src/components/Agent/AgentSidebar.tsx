import React, { useState, useRef, useEffect, useCallback, memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Send, Loader2, AlertCircle, Trash2, CheckCircle, XCircle, Square, History, ChevronLeft, Clock, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgent } from '../../agent/AgentContext';
import { useAgentSidebar } from '../../agent/AgentSidebarContext';
import { AgentMessage } from '../../agent/types';
import {
  fetchAgentSessionList,
  fetchAgentSessionDetail,
  deleteAgentSessionApi,
  createAgentSession,
  type AgentSessionDto,
} from '../../lib/agentApi';
import { useSmartScroll } from '../../hooks/useSmartScroll';
import { NewMessageButton } from './NewMessageButton';

const SIDEBAR_WIDTH = 384;

// 流式输出优化：memoized消息组件，避免不相关的消息重渲染
interface MessageItemProps {
  message: AgentMessage;
  streamingContent?: string;
  expandedToolCalls: Set<string>;
  toggleToolCallExpand: (id: string) => void;
}

const MessageItem = memo(function MessageItem({ message, streamingContent, expandedToolCalls, toggleToolCallExpand }: MessageItemProps) {
  const isUser = message.role === 'user';
  // 优先使用streamingContent（如果存在），否则使用message.content
  const displayContent = streamingContent ?? message.content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''} message-fade-in`}
    >
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-primary text-white' : 'bg-bg-tertiary'
        }`}
      >
        {isUser ? <span className="text-xs font-medium">U</span> : <Bot className="w-3.5 h-3.5" />}
      </div>

      <div
        className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
          isUser
            ? 'bg-white text-text-primary border border-border-primary'
            : 'bg-bg-secondary border border-border-primary'
        } ${streamingContent ? 'streaming-border' : ''}`}
      >
        <div className={`prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-1 ${isUser ? '' : 'dark:prose-invert'}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-primary/50 space-y-2">
            {message.toolCalls.map((toolCall) => {
              const result = message.toolResults?.[toolCall.id];
              const isExpanded = expandedToolCalls.has(toolCall.id);
              return (
                <div key={toolCall.id} className="text-xs">
                  <button
                    onClick={() => toggleToolCallExpand(toolCall.id)}
                    className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    <span>{toolCall.name}</span>
                    {result && (
                      <span className="ml-1">
                        {result.success ? <CheckCircle className="w-3 h-3 text-green-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
                      </span>
                    )}
                  </button>
                  {isExpanded && (
                    <div className="mt-1 p-2 bg-bg-tertiary rounded text-xs">
                      <div className="text-text-muted mb-1">参数:</div>
                      <pre className="text-text-secondary overflow-auto">{JSON.stringify(toolCall.arguments, null, 2)}</pre>
                      {result && (
                        <div className="mt-2 text-text-muted">
                          <div>结果:</div>
                          <pre className="text-text-secondary overflow-auto">{JSON.stringify(result.data ?? result.error, null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}, (prev, next) => {
  // 自定义比较函数：只有相关字段变化才重新渲染
  return prev.message.id === next.message.id
    && prev.message.content === next.message.content
    && prev.message.status === next.message.status
    && prev.streamingContent === next.streamingContent
    && prev.expandedToolCalls === next.expandedToolCalls;
});

export const AgentSidebar: React.FC = () => {
  const { state: sidebarState, close } = useAgentSidebar();
  const { state, sendMessage, stopThinking, confirmAction, rejectAction, clearConversation, newSession, loadHistorySession } = useAgent();
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<AgentSessionDto[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [screenSize, setScreenSize] = useState<'large' | 'medium' | 'mobile'>('large');
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 智能滚动系统
  const { handleScroll, scrollToBottom, scrollState } = useSmartScroll(scrollContainerRef, {
    scrollMode: 'near-bottom',
    isProcessing: state.isProcessing,
  });

  // 响应式检测
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setScreenSize('large');
      else if (window.innerWidth >= 768) setScreenSize('medium');
      else setScreenSize('mobile');
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 流式输出优化：使用智能滚动系统替代固定定时器
  useEffect(() => {
    if (showHistory) return;
    // streamingContent 变化时触发滚动检查（已由 useSmartScroll 内部处理）
    if (state.streamingContent && scrollState.userNearBottom) {
      scrollToBottom(true);
    }
  }, [showHistory, state.streamingContent, scrollState.userNearBottom, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || state.isProcessing) return;
    const message = input.trim();
    setInput('');
    await sendMessage(message);
  }, [input, state.isProcessing, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleConfirm = useCallback(async () => {
    if (!state.confirmationRequest) return;
    await confirmAction();
  }, [state.confirmationRequest, confirmAction]);

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const result = await fetchAgentSessionList({ limit: 10 });
      setHistorySessions(result.items);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory, loadHistory]);

  useEffect(() => {
    if (!state.isProcessing && showHistory) loadHistory();
  }, [state.isProcessing, showHistory, loadHistory]);

  const handleLoadSession = useCallback(async (sessionId: string) => {
    try {
      const detail = await fetchAgentSessionDetail(sessionId);
      loadHistorySession(detail);
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load session:', error);
    }
  }, [loadHistorySession]);

  const handleDeleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个会话吗？会话中的所有对话记录都将被删除。')) return;
    try {
      await deleteAgentSessionApi(sessionId);
      setHistorySessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  }, []);

  // 新建会话
  const handleNewSession = useCallback(async () => {
    try {
      const newSessionData = await createAgentSession('新会话');
      newSession(newSessionData.id);
      await loadHistory();
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to create new session:', error);
    }
  }, [newSession, loadHistory]);

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    if (days < 7) return `${days}天前`;
    return new Date(timestamp).toLocaleDateString('zh-CN');
  };

  const getSessionPreview = (session: AgentSessionDto) => {
    const lastRun = session.runs[session.runs.length - 1];
    if (!lastRun) return '空会话';
    return lastRun.inputText.slice(0, 40) + (lastRun.inputText.length > 40 ? '...' : '');
  };

  const getSessionStatus = (session: AgentSessionDto) => {
    const lastRun = session.runs[session.runs.length - 1];
    if (!lastRun) return 'completed';
    return lastRun.status;
  };

  const toggleToolCallExpand = useCallback((toolCallId: string) => {
    setExpandedToolCalls((prev) => {
      const next = new Set(prev);
      if (next.has(toolCallId)) next.delete(toolCallId);
      else next.add(toolCallId);
      return next;
    });
  }, []);

  // 流式输出优化：构建渲染用的消息列表，合并streamingContent
  const messagesToRender = useMemo(() => {
    return state.messages.map((message) => ({
      message,
      // 如果是正在streaming的消息，使用streamingContent
      streamingContent: state.streamingContent?.messageId === message.id
        ? state.streamingContent.content
        : undefined,
    }));
  }, [state.messages, state.streamingContent]);

  // 非大屏幕时显示遮罩层
  const showOverlay = screenSize !== 'large' && sidebarState.isOpen;

  if (!sidebarState.isOpen) return null;

  return (
    <>
      {/* 遮罩层（移动端/中屏） */}
      <AnimatePresence>
        {showOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40"
            onClick={close}
          />
        )}
      </AnimatePresence>

      {/* Agent 侧边栏 */}
      <motion.aside
        initial={{ width: 0, opacity: 0 }}
        animate={{ width: screenSize === 'mobile' ? '100%' : SIDEBAR_WIDTH, opacity: 1 }}
        exit={{ width: 0, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`h-screen fixed right-0 top-0 z-50 bg-bg-card border-l border-border-primary flex flex-col ${screenSize === 'mobile' ? 'inset-0' : ''}`}
      >
        {/* Header */}
        <div className="p-3 border-b border-border-primary flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-sm">智能助手</h3>
              <div className="flex items-center gap-1 text-xs text-text-muted">
                <span className={`w-1.5 h-1.5 rounded-full ${state.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                {state.isConnected ? '已连接' : '未连接'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewSession}
              className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors"
              title="新建会话"
            >
              <Plus className="w-4 h-4 text-text-muted" />
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`p-1.5 hover:bg-bg-secondary rounded-lg transition-colors ${showHistory ? 'bg-primary/10' : ''}`}
              title="历史记录"
            >
              <History className={`w-4 h-4 ${showHistory ? 'text-primary' : 'text-text-muted'}`} />
            </button>
            <button
              onClick={clearConversation}
              className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors"
              title="清空对话"
            >
              <Trash2 className="w-4 h-4 text-text-muted" />
            </button>
            {screenSize !== 'large' && (
              <button onClick={close} className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors" title="关闭">
                <X className="w-4 h-4 text-text-muted" />
              </button>
            )}
          </div>
        </div>

        {/* 历史记录面板 */}
        <AnimatePresence>
          {showHistory && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 overflow-auto p-3">
              <button onClick={() => setShowHistory(false)} className="flex items-center gap-2 mb-3 hover:opacity-70 transition-opacity">
                <ChevronLeft className="w-4 h-4 text-text-muted" />
                <h4 className="text-sm font-medium text-text-primary">对话历史</h4>
              </button>

              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                </div>
              ) : historySessions.length === 0 ? (
                <div className="text-center py-8 text-text-muted text-sm">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>暂无会话记录</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {historySessions.map((session) => {
                    const status = getSessionStatus(session);
                    return (
                      <motion.div
                        key={session.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => handleLoadSession(session.id)}
                        className="group p-2 rounded-lg border border-border-primary hover:border-primary cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            status === 'completed' ? 'bg-green-500/10 text-green-500' :
                            status === 'failed' ? 'bg-red-500/10 text-red-500' :
                            'bg-gray-500/10 text-gray-500'
                          }`}>
                            {status === 'completed' ? <CheckCircle className="w-3 h-3" /> :
                             status === 'failed' ? <XCircle className="w-3 h-3" /> :
                             <Clock className="w-3 h-3" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary truncate">{session.title || getSessionPreview(session)}</p>
                            <div className="flex items-center gap-2 text-xs text-text-muted mt-1">
                              <span>{session.runs.length} 条对话</span>
                              <span>{formatTime(session.updatedAt)}</span>
                            </div>
                          </div>

                          <button
                            onClick={(e) => handleDeleteSession(session.id, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded transition-all"
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 消息区域 */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className={`flex-1 overflow-auto p-3 space-y-3 ${showHistory ? 'hidden' : ''}`}
          style={{ overscrollBehavior: 'contain' }}
        >
          {/* 新消息提示按钮 */}
          <NewMessageButton
            visible={scrollState.newMessagesBelow}
            onClick={() => scrollToBottom(true)}
          />

          {messagesToRender.length === 0 && (
            <div className="h-full flex items-center justify-center text-center text-text-muted text-sm">
              <div>
                <Bot className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p>有什么可以帮您的？</p>
                <p className="text-xs mt-1 opacity-70">试试："查询我的财务状况" 或 "创建一个任务"</p>
              </div>
            </div>
          )}

          {messagesToRender.map(({ message, streamingContent }) => (
            <MessageItem
              key={message.id}
              message={message}
              streamingContent={streamingContent}
              expandedToolCalls={expandedToolCalls}
              toggleToolCallExpand={toggleToolCallExpand}
            />
          ))}

          {/* 思考状态指示器 - 三点动画 */}
          {state.isProcessing && !state.streamingContent && (
            <div className="flex items-center gap-2 text-text-muted text-sm">
              <div className="reading-indicator" aria-hidden="true">
                <span className="reading-indicator__dot" />
                <span className="reading-indicator__dot" />
                <span className="reading-indicator__dot" />
              </div>
              <span>思考中...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 确认操作栏 */}
        <AnimatePresence>
          {state.confirmationRequest && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="p-3 border-t border-border-primary bg-warning/5 shrink-0"
            >
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-warning">确认操作</p>
                  <p className="text-xs text-text-muted mt-1 whitespace-pre-wrap">{state.confirmationRequest.description}</p>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleConfirm}
                      disabled={state.isProcessing}
                      className="px-3 py-1 bg-warning text-white text-xs rounded-lg hover:bg-warning-dark disabled:opacity-50"
                    >
                      确认执行
                    </button>
                    <button onClick={() => void rejectAction()} className="px-3 py-1 border border-border-primary text-xs rounded-lg hover:bg-bg-secondary">
                      取消
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {state.error && (
          <div className="p-2 bg-error/10 text-error text-xs text-center shrink-0">{state.error}</div>
        )}

        {/* 输入区域 */}
        <div className="p-3 border-t border-border-primary shrink-0">
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入指令或问题..."
              className="flex-1 resize-none border border-border-primary rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary bg-bg-card placeholder:text-text-muted"
              rows={2}
              disabled={!state.isConnected || state.isProcessing || !!state.confirmationRequest}
            />
            {state.isProcessing && (
              <button
                onClick={stopThinking}
                className="px-3 border border-error/40 text-error rounded-lg hover:bg-error/10 transition-colors"
                title="强行终止思考"
              >
                <Square className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!input.trim() || state.isProcessing || !state.isConnected || !!state.confirmationRequest}
              className="px-3 bg-primary text-white rounded-lg disabled:opacity-50 hover:bg-primary-dark transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-xs text-text-muted mt-1 text-center">Ctrl+K 快捷键 · Enter 发送</p>
        </div>
      </motion.aside>
    </>
  );
};