import React from 'react';
import { motion } from 'framer-motion';
import { User, Bot, Wrench, CheckCircle, XCircle, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentRunMessageDto, AgentRunToolExecutionDto } from '../../../lib/agentApi';

interface MessageListProps {
  messages: AgentRunMessageDto[];
  toolExecutions: AgentRunToolExecutionDto[];
}

const roleConfig: Record<string, { icon: React.ElementType; label: string; bgColor: string }> = {
  user: { icon: User, label: '用户', bgColor: 'bg-primary/10' },
  assistant: { icon: Bot, label: '助手', bgColor: 'bg-bg-secondary' },
  system: { icon: Clock, label: '系统', bgColor: 'bg-yellow-500/10' },
  tool: { icon: Wrench, label: '工具', bgColor: 'bg-blue-500/10' },
};

export const MessageList: React.FC<MessageListProps> = ({ messages, toolExecutions }) => {
  const allItems: Array<{
    type: 'message' | 'tool';
    data: AgentRunMessageDto | AgentRunToolExecutionDto;
    sortTime: number;
    fallbackIndex: number;
  }> = [
    ...messages.map((msg, index) => ({
      type: 'message' as const,
      data: msg,
      sortTime: msg.createdAt ?? 0,
      fallbackIndex: index,
    })),
    ...toolExecutions.map((tool, index) => ({
      type: 'tool' as const,
      data: tool,
      sortTime: tool.createdAt ?? 0,
      fallbackIndex: messages.length + index,
    })),
  ];

  allItems.sort((a, b) => {
    if (a.sortTime !== b.sortTime) {
      return a.sortTime - b.sortTime;
    }
    return a.fallbackIndex - b.fallbackIndex;
  });

  if (allItems.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-text-secondary">
        <p>暂无消息记录</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {allItems.map((item, displayIndex) => {
        if (item.type === 'message') {
          const message = item.data as AgentRunMessageDto;
          const config = roleConfig[message.role] || roleConfig.system;
          const Icon = config.icon;

          return (
            <motion.div
              key={message.id || `msg-${displayIndex}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: displayIndex * 0.05 }}
              className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`flex-shrink-0 w-8 h-8 rounded-full ${config.bgColor} flex items-center justify-center`}>
                <Icon className="w-4 h-4 text-text-secondary" />
              </div>

              <div className={`flex-1 max-w-[80%] ${message.role === 'user' ? 'text-right' : ''}`}>
                <div className={`inline-block p-3 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-white text-text-primary border border-border-primary'
                    : 'bg-bg-secondary text-text-primary'
                }`}>
                  <div className={`prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-pre:my-1 ${
                    message.role === 'user' ? '' : 'dark:prose-invert'
                  }`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.content}
                    </ReactMarkdown>
                  </div>
                </div>
                <p className="text-xs text-text-secondary mt-1">
                  {message.createdAt ? new Date(message.createdAt).toLocaleString('zh-CN') : '未知时间'}
                </p>
              </div>
            </motion.div>
          );
        }

        const tool = item.data as AgentRunToolExecutionDto;
        const isSuccess = tool.status === 'completed';
        const StatusIcon = isSuccess ? CheckCircle : XCircle;

        return (
          <motion.div
            key={tool.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: displayIndex * 0.05 }}
            className="flex gap-3"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Wrench className="w-4 h-4 text-blue-500" />
            </div>

            <div className="flex-1 p-3 rounded-lg bg-bg-secondary border border-border">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-text-primary">{tool.toolName}</span>
                <StatusIcon className={`w-4 h-4 ${isSuccess ? 'text-green-500' : 'text-red-500'}`} />
              </div>

              {Object.keys(tool.arguments).length > 0 && (
                <div className="mb-2">
                  <p className="text-xs text-text-secondary mb-1">参数:</p>
                  <pre className="text-xs bg-bg-primary p-2 rounded overflow-x-auto">
                    {JSON.stringify(tool.arguments, null, 2)}
                  </pre>
                </div>
              )}

              {tool.result && (
                <div>
                  <p className="text-xs text-text-secondary mb-1">结果:</p>
                  <pre className="text-xs bg-bg-primary p-2 rounded overflow-x-auto max-h-40">
                    {JSON.stringify(tool.result, null, 2)}
                  </pre>
                </div>
              )}

              {tool.errorMessage && (
                <p className="text-xs text-red-500 mt-2">{tool.errorMessage}</p>
              )}

              <p className="text-xs text-text-secondary mt-2">
                {tool.createdAt ? new Date(tool.createdAt).toLocaleString('zh-CN') : '未知时间'}
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
