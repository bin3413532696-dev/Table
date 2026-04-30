import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Circle, Edit2, Trash2, Calendar, Clock } from 'lucide-react';
import type { Task } from '../../../db';
import type { PriorityType } from '../index';

const PRIORITY_CONFIG: Record<PriorityType, { label: string; color: string; bgColor: string }> = {
  high: { label: '高', color: 'text-error', bgColor: 'bg-error' },
  medium: { label: '中', color: 'text-warning', bgColor: 'bg-warning' },
  low: { label: '低', color: 'text-success', bgColor: 'bg-success' },
};

interface TaskItemProps {
  task: Task;
  editingId: string | null;
  editTitle: string;
  editPriority: PriorityType;
  editDueDate: string;
  selectedIds: Set<string>;
  showBatchActions: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onStartEdit: (task: Task) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onTitleChange: (title: string) => void;
  onPriorityChange: (p: PriorityType) => void;
  onDueDateChange: (date: string) => void;
  onToggleSelect: (id: string) => void;
  index?: number;
}

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  editingId,
  editTitle,
  editPriority,
  editDueDate,
  selectedIds,
  showBatchActions,
  onToggle,
  onDelete,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onTitleChange,
  onPriorityChange,
  onDueDateChange,
  onToggleSelect,
  index,
}) => {
  const config = PRIORITY_CONFIG[task.priority];
  const isOverdue = (dueDate?: string, completed?: boolean) => {
    if (!dueDate || completed) return false;
    const now = new Date();
    const due = new Date(dueDate);
    return due < new Date(now.getFullYear(), now.getMonth(), now.getDate());
  };
  const getOverdueDays = (dueDate?: string) => {
    if (!dueDate) return 0;
    const now = new Date();
    const due = new Date(dueDate);
    return Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  };
  const overdue = isOverdue(task.dueDate, task.completed);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`group relative flex items-center gap-4 p-4 rounded-lg border transition-all duration-150 ${
        task.completed
          ? 'bg-bg-secondary/50 border-border-primary'
          : 'bg-bg-card border-border-primary hover:border-primary/30 hover:shadow-card'
      }`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l ${overdue ? 'bg-error' : config.bgColor}`} />

      {showBatchActions && (
        <input
          type="checkbox"
          checked={selectedIds.has(task.id)}
          onChange={() => onToggleSelect(task.id)}
          className="w-4 h-4 rounded border-border-primary accent-primary"
        />
      )}

      <button
        onClick={() => onToggle(task.id)}
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
          task.completed
            ? 'bg-success text-white'
            : 'border-2 border-border-secondary hover:border-primary'
        }`}
      >
        {task.completed && <CheckCircle size={14} />}
      </button>

      <div className="flex-1 min-w-0">
        {editingId === task.id ? (
          <div className="space-y-3">
            <input
              type="text"
              value={editTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(); if (e.key === 'Escape') onCancelEdit(); }}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary bg-bg-card border-border-primary text-text-primary"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <PriorityButtonGroup selected={editPriority} onChange={onPriorityChange} />
              <input
                type="date"
                value={editDueDate}
                onChange={(e) => onDueDateChange(e.target.value)}
                className="px-2 py-1 border rounded text-sm bg-bg-card border-border-primary text-text-secondary"
              />
              <button onClick={onSaveEdit} className="px-3 py-1 bg-primary text-white rounded text-sm">保存</button>
              <button onClick={onCancelEdit} className="px-3 py-1 bg-bg-secondary text-text-secondary rounded text-sm">取消</button>
            </div>
          </div>
        ) : (
          <>
            <p className={`font-medium ${task.completed ? 'text-text-muted line-through' : 'text-text-primary'}`}>
              {task.title}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <Calendar size={12} />
                {new Date(task.createdAt).toLocaleDateString()}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${config.bgColor}/10 ${config.color} border border-current/20`}>
                {config.label}
              </span>
              {task.dueDate && (
                <span className={`flex items-center gap-1 text-xs ${overdue ? 'text-error font-medium' : 'text-text-muted'}`}>
                  <Clock size={12} />
                  {new Date(task.dueDate).toLocaleDateString()}
                  {overdue && <span className="text-error">(逾期{getOverdueDays(task.dueDate)}天)</span>}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {editingId !== task.id && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onStartEdit(task)}
            className="p-2 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <Edit2 size={16} />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            className="p-2 rounded-lg text-text-muted hover:text-error hover:bg-error/10 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </motion.div>
  );
};

interface PriorityButtonGroupProps {
  selected: PriorityType;
  onChange: (p: PriorityType) => void;
}

export const PriorityButtonGroup: React.FC<PriorityButtonGroupProps> = ({ selected, onChange }) => {
  const priorities: PriorityType[] = ['low', 'medium', 'high'];
  return (
    <div className="flex gap-1">
      {priorities.map(p => {
        const config = PRIORITY_CONFIG[p];
        const isSelected = selected === p;
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`px-2 py-1 text-xs rounded font-medium transition-all flex items-center gap-1 ${
              isSelected
                ? `${config.bgColor} text-white shadow-sm`
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary border border-border-primary'
            }`}
          >
            {config.label}
          </button>
        );
      })}
    </div>
  );
};