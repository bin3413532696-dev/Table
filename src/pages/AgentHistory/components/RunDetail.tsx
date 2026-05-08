import React from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ArrowRight,
  Trash2,
  Bot,
  Calendar,
} from 'lucide-react';
import type { AgentRunDetailDto } from '../../../lib/agentApi';
import { MessageList } from './MessageList';
import { Button } from '../../../components/ui';

interface RunDetailProps {
  run: AgentRunDetailDto;
  onContinue: () => void;
  onDelete: () => void;
  isLoading: boolean;
}

import { MESSAGES } from '../../../core/messages';

const statusConfig: Record<string, { icon: React.ElementType; color: string; label: string; bgColor: string }> = {
  completed: { icon: CheckCircle, color: 'text-green-500', label: MESSAGES.agent.statusCompleted, bgColor: 'bg-green-500/10' },
  failed: { icon: XCircle, color: 'text-red-500', label: MESSAGES.agent.statusFailed, bgColor: 'bg-red-500/10' },
  cancelled: { icon: XCircle, color: 'text-gray-400', label: MESSAGES.agent.statusCancelled, bgColor: 'bg-gray-500/10' },
  waiting_confirmation: { icon: Clock, color: 'text-yellow-500', label: MESSAGES.agent.statusWaiting, bgColor: 'bg-yellow-500/10' },
  running: { icon: AlertCircle, color: 'text-blue-500', label: MESSAGES.agent.statusRunning, bgColor: 'bg-blue-500/10' },
  pending: { icon: Clock, color: 'text-gray-400', label: MESSAGES.agent.statusPending, bgColor: 'bg-gray-500/10' },
};

export const RunDetail: React.FC<RunDetailProps> = ({ run, onContinue, onDelete, isLoading }) => {
  const status = statusConfig[run.status] || statusConfig.pending;
  const StatusIcon = status.icon;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full flex flex-col"
    >
      {/* 顶部状态栏 */}
      <div className="flex-shrink-0 p-4 border-b border-border bg-bg-primary">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full ${status.bgColor} flex items-center justify-center`}>
              <StatusIcon className={`w-4 h-4 ${status.color}`} />
            </div>
            <div>
              <h3 className="text-lg font-medium text-text-primary">对话详情</h3>
              <p className="text-xs text-text-secondary">
                {run.id.slice(0, 8)}...
              </p>
            </div>
          </div>

          <span className={`text-sm px-3 py-1 rounded-full ${status.color} ${status.bgColor}`}>
            {status.label}
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <div className="flex items-center gap-1">
            <Bot className="w-4 h-4" />
            <span>{run.model}</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            <span>{new Date(run.createdAt).toLocaleString('zh-CN')}</span>
          </div>
        </div>

        {run.errorMessage && (
          <div className="mt-3 p-2 rounded bg-red-500/10 text-red-500 text-sm">
            {run.errorMessage}
          </div>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <MessageList messages={run.messages} toolExecutions={run.toolExecutions} />
      </div>

      {/* 底部操作栏 */}
      <div className="flex-shrink-0 p-4 border-t border-border bg-bg-primary">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={onContinue}
            disabled={isLoading}
            icon={<ArrowRight className="w-4 h-4" />}
            className="flex-1"
          >
            继续对话
          </Button>

          <Button
            variant="ghost"
            onClick={onDelete}
            disabled={isLoading}
            icon={<Trash2 className="w-4 h-4" />}
            className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
          >
            删除
          </Button>
        </div>
      </div>
    </motion.div>
  );
};