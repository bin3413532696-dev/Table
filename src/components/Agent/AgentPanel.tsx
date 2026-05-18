import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Send, Loader2, AlertCircle, Trash2, CheckCircle, XCircle, Square, History, ChevronLeft, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAgent } from '../../agent/AgentContext';
import { AgentMessage } from '../../agent/types';
import { registeredToolNames } from '../../agent/toolMetadata';
import { fetchAgentRunList, fetchAgentRunDetail, deleteAgentRunApi, type AgentRunDto } from '../../lib/agentApi';

interface AgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ isOpen, onClose }) => {
  const { state, sendMessage, stopThinking, confirmAction, rejectAction, clearConversation, loadHistoryRun } = useAgent();
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<AgentRunDto[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

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

  // 加载历史记录
  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const result = await fetchAgentRunList({ limit: 10 });
      setHistoryRuns(result.items);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // 打开历史面板
  useEffect(() => {
    if (showHistory) {
      loadHistory();
    }
  }, [showHistory, loadHistory]);

  // 加载历史会话到当前对话
  const handleLoadRun = useCallback(async (runId: string) => {
    try {
      const detail = await fetchAgentRunDetail(runId);
      loadHistoryRun(detail);
      setShowHistory(false);
    } catch (error) {
      console.error('Failed to load run:', error);
    }
  }, [loadHistoryRun]);

  // 删除历史记录
  const handleDeleteRun = useCallback(async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定要删除这条对话记录吗？')) return;
    try {
      await deleteAgentRunApi(runId);
      setHistoryRuns(prev => prev.filter(r => r.id !== runId));
    } catch (error) {
      console.error('Failed to delete run:', error);
    }
  }, []);

  // 格式化时间
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

  const renderMessage = (message: AgentMessage) => {
    const isUser = message.role === 'user';

    return (
      <motion.div
        key={message.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}
      >
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
            isUser ? 'bg-primary text-white' : 'bg-bg-tertiary'
          }`}
        >
          {isUser ? (
            <span className="text-xs font-medium">U</span>
          ) : (
            <Bot className="w-3.5 h-3.5" />
          )}
        </div>

        <div
          className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
            isUser
              ? 'bg-white text-text-primary border border-border-primary'
              : 'bg-bg-secondary border border-border-primary'
          }`}
        >
          <div className={`prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-1 ${
            isUser ? '' : 'dark:prose-invert'
          }`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>

          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border-primary/50">
              {message.toolCalls.map((toolCall) => (
                <div key={toolCall.id} className="text-xs">
                  {(() => {
                    const result = message.toolResults?.[toolCall.id];
                    return (
                      <>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                    {toolCall.name}
                  </span>
                  {result && (
                    <span className="ml-2">
                      {result.success ? (
                        <CheckCircle className="w-3 h-3 text-green-500 inline" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-500 inline" />
                      )}
                    </span>
                  )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 right-4 w-96 h-[500px] bg-bg-card border border-border-primary rounded-xl shadow-2xl flex flex-col z-50 overflow-hidden"
        >
          <div className="p-3 border-b border-border-primary flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h3 className="font-medium text-sm">智能助手</h3>
                <div className="flex items-center gap-1 text-xs text-text-muted">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      state.isConnected ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  {state.isConnected ? '已连接' : '未连接'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
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
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors"
                title="关闭"
              >
                <X className="w-4 h-4 text-text-muted" />
              </button>
            </div>
          </div>

          {/* 历史记录面板 */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 overflow-auto p-3"
              >
                <button
                  onClick={() => setShowHistory(false)}
                  className="flex items-center gap-2 mb-3 hover:opacity-70 transition-opacity"
                >
                  <ChevronLeft className="w-4 h-4 text-text-muted" />
                  <h4 className="text-sm font-medium text-text-primary">对话历史</h4>
                </button>

                {isLoadingHistory ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
                  </div>
                ) : historyRuns.length === 0 ? (
                  <div className="text-center py-8 text-text-muted text-sm">
                    <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>暂无对话记录</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {historyRuns.map((run) => (
                      <motion.div
                        key={run.id}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        onClick={() => handleLoadRun(run.id)}
                        className="group p-2 rounded-lg border border-border-primary hover:border-primary cursor-pointer transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                            run.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                            run.status === 'failed' ? 'bg-red-500/10 text-red-500' :
                            'bg-gray-500/10 text-gray-500'
                          }`}>
                            {run.status === 'completed' ? <CheckCircle className="w-3 h-3" /> :
                             run.status === 'failed' ? <XCircle className="w-3 h-3" /> :
                             <Clock className="w-3 h-3" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-text-primary truncate">
                              {run.inputText.slice(0, 40)}{run.inputText.length > 40 ? '...' : ''}
                            </p>
                            <p className="text-xs text-text-muted mt-1">
                              {formatTime(run.createdAt)}
                            </p>
                          </div>

                          <button
                            onClick={(e) => handleDeleteRun(run.id, e)}
                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded transition-all"
                          >
                            <Trash2 className="w-3 h-3 text-red-500" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* 消息区域 */}
          <div className={`flex-1 overflow-auto p-3 space-y-3 ${showHistory ? 'hidden' : ''}`}>
            {state.messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-center text-text-muted text-sm">
                <div>
                  <Bot className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>有什么可以帮您的？</p>
                  <p className="text-xs mt-1 opacity-70">试试：“查询我的财务状况” 或 “创建一个任务”</p>
                </div>
              </div>
            )}

            {state.messages.map(renderMessage)}

            {state.isProcessing && (
              <div className="flex items-center gap-2 text-text-muted text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>思考中...</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

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
                    <p className="text-xs text-text-muted mt-1 whitespace-pre-wrap">
                      {state.confirmationRequest.description}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleConfirm}
                        disabled={state.isProcessing}
                        className="px-3 py-1 bg-warning text-white text-xs rounded-lg hover:bg-warning-dark disabled:opacity-50"
                      >
                        确认执行
                      </button>
                      <button
                        onClick={() => void rejectAction()}
                        className="px-3 py-1 border border-border-primary text-xs rounded-lg hover:bg-bg-secondary"
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
            <div className="p-2 bg-error/10 text-error text-xs text-center shrink-0">
              {state.error}
            </div>
          )}

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
            <p className="text-xs text-text-muted mt-1 text-center">
              Ctrl+K 快捷键 · Enter 发送
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
