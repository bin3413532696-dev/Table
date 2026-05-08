import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  Trash2,
  Calendar,
  Bot,
} from 'lucide-react';
import { AgentRunDto } from '../../../lib/agentApi';
import { Button } from '../../../components/ui';
import { MESSAGES } from '../../../core/messages';

interface RunListProps {
  runs: AgentRunDto[];
  selectedId?: string;
  onSelect: (run: AgentRunDto) => void;
  onDelete: (runId: string) => void;
  isLoading: boolean;
}

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  completed: { icon: CheckCircle, color: 'text-green-500', label: MESSAGES.agent.statusCompleted },
  failed: { icon: XCircle, color: 'text-red-500', label: MESSAGES.agent.statusFailed },
  cancelled: { icon: XCircle, color: 'text-gray-400', label: MESSAGES.agent.statusCancelled },
  waiting_confirmation: { icon: Clock, color: 'text-yellow-500', label: MESSAGES.agent.statusWaiting },
  running: { icon: AlertCircle, color: 'text-blue-500', label: MESSAGES.agent.statusRunning },
  pending: { icon: Clock, color: 'text-gray-400', label: MESSAGES.agent.statusPending },
};

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function truncateText(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export const RunList: React.FC<RunListProps> = ({
  runs,
  selectedId,
  onSelect,
  onDelete,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-text-secondary">
        <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-lg">暂无对话记录</p>
        <p className="text-sm mt-2">开始与智能体对话后，记录将保存在这里</p>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <div className="space-y-2">
        {runs.map((run, index) => {
          const status = statusConfig[run.status] || statusConfig.pending;
          const StatusIcon = status.icon;

          return (
            <motion.div
              key={run.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ delay: index * 0.05 }}
              onClick={() => onSelect(run)}
              className={`group cursor-pointer p-4 rounded-lg border transition-all ${
                selectedId === run.id
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50 hover:bg-bg-secondary'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 ${status.color}`}>
                  <StatusIcon className="w-5 h-5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {truncateText(run.inputText)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${status.color} bg-current/10`}>
                      {status.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-text-secondary">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {formatRelativeTime(run.createdAt)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Bot className="w-3 h-3" />
                      {run.model}
                    </div>
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(run.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      onDelete(run.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded hover:bg-red-500/10 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4 text-text-secondary hover:text-red-500" />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </AnimatePresence>
  );
};