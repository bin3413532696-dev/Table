import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X } from 'lucide-react';
import { AgentPanel } from './AgentPanel';
import { useAgent } from '../../agent/AgentContext';

export const AgentTrigger: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { state, checkConnection } = useAgent();

  // 全局快捷键: Ctrl+K 或 Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      // Escape 关闭
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // 定期检查连接状态
  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000);
    return () => clearInterval(interval);
  }, [checkConnection]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <>
      {/* 浮动触发按钮 */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleToggle}
            className="fixed bottom-4 right-4 w-12 h-12 bg-primary text-white rounded-full shadow-lg flex items-center justify-center z-40 hover:shadow-xl transition-shadow"
            title="智能助手 (Ctrl+K)"
          >
            <Bot className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* 连接状态指示器 */}
      {!state.isConnected && !isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed bottom-16 right-4 px-2 py-1 bg-error/10 text-error text-xs rounded z-40 flex items-center gap-1"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />
          AI 未连接
        </motion.div>
      )}

      {/* 面板 */}
      <AgentPanel isOpen={isOpen} onClose={handleClose} />
    </>
  );
};