import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Send, Loader2, AlertCircle, Settings, Trash2, CheckCircle, XCircle, Square } from 'lucide-react';
import { useAgent } from '../../agent/AgentContext';
import { agentEngine } from '../../agent/AgentEngine';
import { AgentMessage } from '../../agent/types';

interface AgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({ isOpen, onClose }) => {
  const { state, sendMessage, stopThinking, confirmAction, rejectAction, clearConversation, selectModel } = useAgent();
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
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
    const toolCall = {
      id: state.confirmationRequest.id,
      name: state.confirmationRequest.toolName,
      arguments: state.confirmationRequest.arguments,
    };
    await confirmAction(() => agentEngine.executeTool(toolCall, true));
  }, [state.confirmationRequest, confirmAction]);

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
              ? 'bg-primary text-white'
              : 'bg-bg-secondary border border-border-primary'
          }`}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>

          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border-primary/50">
              {message.toolCalls.map((toolCall) => (
                <div key={toolCall.id} className="text-xs">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                    {toolCall.name}
                  </span>
                  {message.toolResult && (
                    <span className="ml-2">
                      {message.toolResult.success ? (
                        <CheckCircle className="w-3 h-3 text-green-500 inline" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-500 inline" />
                      )}
                    </span>
                  )}
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
                onClick={() => setShowSettings(!showSettings)}
                className="p-1.5 hover:bg-bg-secondary rounded-lg transition-colors"
                title="设置"
              >
                <Settings className="w-4 h-4 text-text-muted" />
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

          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                className="border-b border-border-primary overflow-hidden shrink-0"
              >
                <div className="p-3 space-y-2">
                  <label className="text-xs text-text-muted">选择模型</label>
                  <select
                    value={state.selectedModel}
                    onChange={(e) => selectModel(e.target.value)}
                    disabled={state.availableModels.length === 0}
                    className="w-full text-sm border border-border-primary rounded-lg px-2 py-1.5 bg-bg-card focus:outline-none focus:border-primary disabled:opacity-50"
                  >
                    {state.availableModels.length === 0 ? (
                      <option>无可用模型</option>
                    ) : (
                      state.availableModels.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))
                    )}
                  </select>
                  <p className="text-xs text-text-muted">
                    可用工具：{agentEngine.getAvailableTools().length} 个
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="flex-1 overflow-auto p-3 space-y-3">
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
                        onClick={rejectAction}
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
