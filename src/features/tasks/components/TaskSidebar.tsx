import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Flag, CalendarDays, Clock, ArrowRight, CheckCircle } from 'lucide-react';

interface TaskStats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
  dueToday: number;
  dueThisWeek: number;
}

interface TaskSidebarProps {
  stats: TaskStats;
  onQuickFilter: (filter: 'high' | 'overdue' | 'today' | 'week') => void;
}

export const TaskSidebar: React.FC<TaskSidebarProps> = ({ stats, onQuickFilter }) => {
  const totalPending = stats.highPriority + stats.mediumPriority + stats.lowPriority;
  const highPercent = totalPending > 0 ? Math.round((stats.highPriority / totalPending) * 100) : 0;
  const mediumPercent = totalPending > 0 ? Math.round((stats.mediumPriority / totalPending) * 100) : 0;
  const lowPercent = totalPending > 0 ? Math.round((stats.lowPriority / totalPending) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* 状态概览卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-lg shadow-md border p-4 bg-bg-card border-border-primary"
      >
        <div className="flex items-center gap-2 mb-3">
          <Flag className="w-4 h-4 text-text-secondary" />
          <h3 className="text-sm font-semibold text-text-primary">状态概览</h3>
        </div>

        {/* 优先级分布 - 紧凑进度条形式 */}
        <div className="mb-4">
          <p className="text-xs text-text-muted mb-2">待办优先级分布</p>

          {/* 单条横向进度条 */}
          <div className="h-2 rounded-full bg-bg-secondary overflow-hidden mb-2">
            {stats.highPriority > 0 && (
              <div className="h-full bg-error float-left" style={{ width: `${highPercent}%` }} />
            )}
            {stats.mediumPriority > 0 && (
              <div className="h-full bg-warning float-left" style={{ width: `${mediumPercent}%` }} />
            )}
            {stats.lowPriority > 0 && (
              <div className="h-full bg-success float-left" style={{ width: `${lowPercent}%` }} />
            )}
          </div>

          {/* 数值列表 */}
          <div className="flex justify-between text-xs">
            <button
              onClick={() => onQuickFilter('high')}
              className="flex items-center gap-1 hover:text-error transition-colors group"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-error" />
              <span className="text-text-muted group-hover:text-error">高 {stats.highPriority}</span>
            </button>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" />
              <span className="text-text-muted">中 {stats.mediumPriority}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-text-muted">低 {stats.lowPriority}</span>
            </div>
          </div>
        </div>

        {/* 时间提醒 */}
        <div>
          <p className="text-xs text-text-muted mb-2">截止日期提醒</p>
          <div className="space-y-1.5">
            <button
              onClick={() => onQuickFilter('today')}
              className="flex items-center justify-between w-full p-2 rounded-lg bg-warning/10 hover:bg-warning/15 transition-colors group border border-warning/25"
            >
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-warning" />
                <span className="text-sm text-text-secondary">今日截止</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm font-semibold text-warning">{stats.dueToday}</span>
                <ArrowRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
            <button
              onClick={() => onQuickFilter('week')}
              className="flex items-center justify-between w-full p-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors group"
            >
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-text-muted" />
                <span className="text-sm text-text-secondary">本周截止</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-text-primary">{stats.dueThisWeek}</span>
                <ArrowRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
            {stats.overdue > 0 && (
              <button
                onClick={() => onQuickFilter('overdue')}
                className="flex items-center justify-between w-full p-2 rounded-lg bg-error/15 hover:bg-error/20 transition-colors group border border-error/30"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-error" />
                  <span className="text-sm text-error font-medium">已逾期</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold text-error">{stats.overdue}</span>
                  <ArrowRight className="w-4 h-4 text-error opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* 快捷筛选卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-lg shadow-md border p-4 bg-bg-card border-border-primary"
      >
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="w-4 h-4 text-text-secondary" />
          <h3 className="text-sm font-semibold text-text-primary">快捷筛选</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onQuickFilter('high')}
            className="px-3 py-1.5 text-sm rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors font-medium"
          >
            高优先级
          </button>
          <button
            onClick={() => onQuickFilter('today')}
            className="px-3 py-1.5 text-sm rounded-lg bg-warning/10 text-warning hover:bg-warning/20 transition-colors font-medium"
          >
            今日截止
          </button>
          {stats.overdue > 0 && (
            <button
              onClick={() => onQuickFilter('overdue')}
              className="px-3 py-1.5 text-sm rounded-lg bg-error/15 text-error hover:bg-error/25 transition-colors font-medium"
            >
              已逾期
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};
