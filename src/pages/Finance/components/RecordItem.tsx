import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Edit3, Trash2 } from 'lucide-react';
import type { FinanceRecord } from '../../../db';

const MAX_DESCRIPTION_DISPLAY = 50;

interface RecordItemProps {
  record: FinanceRecord;
  showBatchActions: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (record: FinanceRecord) => void;
  onDelete: (id: string) => void;
  index?: number;
}

const formatDisplayDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dateStr === today.toISOString().split('T')[0]) return '今天';
  if (dateStr === yesterday.toISOString().split('T')[0]) return '昨天';
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

export const RecordItem: React.FC<RecordItemProps> = ({
  record,
  showBatchActions,
  selectedIds,
  onToggleSelect,
  onEdit,
  onDelete,
  index
}) => {
  const truncatedDescription = record.description.length > MAX_DESCRIPTION_DISPLAY
    ? record.description.slice(0, MAX_DESCRIPTION_DISPLAY) + '...'
    : record.description;

  return (
    <motion.div
      key={record.id}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={index !== undefined ? { delay: Math.min(index * 0.03, 0.3) } : undefined}
      className="p-4 flex items-center justify-between transition-colors group hover:bg-bg-secondary"
    >
      <div className="flex items-center gap-4 min-w-0 flex-1">
        {showBatchActions && (
          <input
            type="checkbox"
            checked={selectedIds.has(record.id)}
            onChange={() => onToggleSelect(record.id)}
            className="w-4 h-4 rounded border-border-primary accent-primary shrink-0"
          />
        )}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          record.type === 'income'
            ? 'bg-success-light text-success dark:bg-success/20 dark:text-success-400'
            : 'bg-error-light text-error dark:bg-error/20 dark:text-error-400'
        }`}>
          {record.type === 'income' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text-primary truncate" title={record.description}>
            {truncatedDescription}
          </p>
          <div className="flex items-center gap-2 text-sm text-text-muted flex-wrap">
            <span className="truncate max-w-[100px]" title={record.category}>{record.category}</span>
            {record.model && (
              <>
                <span className="text-text-muted/50">·</span>
                <span className="truncate max-w-[80px]" title={record.model}>{record.model}</span>
              </>
            )}
            <span className="text-text-muted/50">·</span>
            <span className="shrink-0">{formatDisplayDate(record.date)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <span className={`text-lg font-semibold tabular-nums ${
          record.type === 'income'
            ? 'text-success dark:text-success-400'
            : 'text-error dark:text-error-400'
        }`}>
          {record.type === 'income' ? '+' : '-'}¥{record.amount.toLocaleString()}
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(record)}
            className="p-2 rounded-lg transition-colors text-text-muted hover:text-primary hover:bg-primary-50 dark:hover:bg-primary-900/20"
            title="编辑"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => onDelete(record.id)}
            className="p-2 rounded-lg transition-colors text-text-muted hover:text-error hover:bg-error-light dark:hover:bg-error/20"
            title="删除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};