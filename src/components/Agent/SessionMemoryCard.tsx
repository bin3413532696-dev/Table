import React, { useState } from 'react';
import { Brain, Loader2, RefreshCcw, ShieldOff, Trash2 } from 'lucide-react';
import type { AgentSessionMemoryDto } from '../../lib/agentApi';

interface SessionMemoryCardProps {
  memory: AgentSessionMemoryDto | null;
  onRefresh: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onToggleDisabled: (disabled: boolean) => void | Promise<void>;
  compact?: boolean;
}

const statusLabel: Record<AgentSessionMemoryDto['status'], string> = {
  idle: '未生成',
  pending: '待更新',
  processing: '生成中',
  ready: '已就绪',
  failed: '更新失败',
};

const statusClass: Record<AgentSessionMemoryDto['status'], string> = {
  idle: 'bg-bg-tertiary text-text-secondary',
  pending: 'bg-warning/10 text-warning',
  processing: 'bg-primary/10 text-primary',
  ready: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
};

function formatMemoryTime(timestamp?: number | null): string {
  if (!timestamp) {
    return '尚未更新';
  }
  return new Date(timestamp).toLocaleString('zh-CN');
}

function renderSection(title: string, items: string[]) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-text-secondary">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={`${title}-${item}`} className="text-xs px-2 py-1 rounded-full bg-bg-primary border border-border-primary text-text-primary">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export const SessionMemoryCard: React.FC<SessionMemoryCardProps> = ({
  memory,
  onRefresh,
  onDelete,
  onToggleDisabled,
  compact = false,
}) => {
  const [pendingAction, setPendingAction] = useState<'refresh' | 'delete' | 'toggle' | null>(null);
  const resolvedMemory: AgentSessionMemoryDto = memory ?? {
    summary: '',
    preferences: [],
    facts: [],
    goals: [],
    todos: [],
    rules: [],
    status: 'idle',
    updatedAt: null,
    disabled: false,
    runCount: 0,
  };

  const goalItems = resolvedMemory.goals.map((goal) => `${goal.title}（${goal.status}）`);
  const todoItems = resolvedMemory.todos.map((todo) =>
    todo.dueHint ? `${todo.title}（${todo.status}，${todo.dueHint}）` : `${todo.title}（${todo.status}）`
  );
  const hasMemoryContent = Boolean(
    resolvedMemory.summary
    || resolvedMemory.preferences.length
    || resolvedMemory.facts.length
    || resolvedMemory.goals.length
    || resolvedMemory.todos.length
    || resolvedMemory.rules.length
  );

  const runAction = async (
    action: 'refresh' | 'delete' | 'toggle',
    handler: () => void | Promise<void>
  ) => {
    try {
      setPendingAction(action);
      await handler();
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async () => {
    if (typeof window !== 'undefined' && !window.confirm('确定要删除当前会话记忆吗？此操作会清空摘要、偏好、规则等记忆内容。')) {
      return;
    }

    await runAction('delete', onDelete);
  };

  return (
    <div className="rounded-lg border border-border-primary bg-bg-secondary p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            {resolvedMemory.status === 'processing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-text-primary">会话记忆</p>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusClass[resolvedMemory.status]}`}>
                {pendingAction === 'refresh' ? '刷新中' : statusLabel[resolvedMemory.status]}
            </span>
            {resolvedMemory.disabled && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-tertiary text-text-secondary">
                  已关闭
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted mt-1">
              {formatMemoryTime(resolvedMemory.updatedAt)} · 已纳入 {resolvedMemory.runCount} 轮对话
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => void runAction('refresh', onRefresh)}
            disabled={pendingAction !== null}
            className="p-1.5 rounded-md hover:bg-bg-tertiary transition-colors disabled:opacity-50"
            title="刷新记忆状态"
          >
            {pendingAction === 'refresh'
              ? <Loader2 className="w-4 h-4 text-text-muted animate-spin" />
              : <RefreshCcw className="w-4 h-4 text-text-muted" />}
          </button>
          <button
            onClick={() => void runAction('toggle', () => onToggleDisabled(!resolvedMemory.disabled))}
            disabled={pendingAction !== null}
            className={`p-1.5 rounded-md transition-colors ${
              resolvedMemory.disabled ? 'bg-warning/10 text-warning' : 'hover:bg-bg-tertiary text-text-muted'
            }`}
            title={resolvedMemory.disabled ? '重新启用记忆' : '关闭当前会话记忆'}
          >
            {pendingAction === 'toggle'
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <ShieldOff className="w-4 h-4" />}
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={pendingAction !== null}
            className="p-1.5 rounded-md hover:bg-error/10 transition-colors disabled:opacity-50"
            title="删除当前会话记忆"
          >
            {pendingAction === 'delete'
              ? <Loader2 className="w-4 h-4 text-error animate-spin" />
              : <Trash2 className="w-4 h-4 text-error" />}
          </button>
        </div>
      </div>

      {!hasMemoryContent ? (
        <p className="text-xs text-text-muted">
          {resolvedMemory.disabled
            ? '当前会话已关闭记忆更新。'
            : resolvedMemory.status === 'failed'
            ? '本次记忆更新失败，可以稍后刷新或在下一轮对话后重试。'
            : '当前还没有可复用的会话记忆。'}
        </p>
      ) : (
        <div className="space-y-3">
          {resolvedMemory.summary && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-text-secondary">摘要</p>
              <p className={`text-sm text-text-primary leading-6 ${compact ? 'line-clamp-4' : ''}`}>
                {resolvedMemory.summary}
              </p>
            </div>
          )}
          {renderSection('偏好', resolvedMemory.preferences)}
          {renderSection('事实', resolvedMemory.facts)}
          {renderSection('目标', goalItems)}
          {renderSection('待办', todoItems)}
          {renderSection('规则', resolvedMemory.rules)}
        </div>
      )}
    </div>
  );
};
