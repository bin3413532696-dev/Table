import React from 'react';
import { motion } from 'framer-motion';
import { Bot } from 'lucide-react';
import { useAgentSidebar } from '../../agent/AgentSidebarContext';
import { useAgent } from '../../agent/AgentContext';

export const Header: React.FC = () => {
  const { toggle, state: sidebarState } = useAgentSidebar();
  const { state: agentState } = useAgent();

  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="h-16 flex items-center justify-between px-6 sticky top-0 z-30 bg-bg-primary/80 backdrop-blur-xl border-b border-border-primary/50 shadow-sm"
    >
      <h1 className="text-lg font-semibold tracking-tight text-text-primary ml-10 md:ml-0">个人工作站</h1>

      {/* Agent 开关按钮 */}
      <div className="flex items-center gap-2">
        {!agentState.isConnected && (
          <span className="text-xs text-error flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />
            AI 未连接
          </span>
        )}

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggle}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors ${
            sidebarState.isOpen
              ? 'bg-primary text-white'
              : 'bg-bg-secondary border border-border-primary text-text-primary'
          }`}
          title="智能助手 (Ctrl+K)"
        >
          <Bot className="w-4 h-4" />
          <span className="text-sm hidden sm:inline">AI助手</span>
        </motion.button>
      </div>
    </motion.header>
  );
};