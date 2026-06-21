import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Edit3, Trash2, Calendar } from 'lucide-react';
import type { FinanceRecord } from '../../../features/finance/types';

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

  const isIncome = record.type === 'income';
  const isSelected = selectedIds.has(record.id);

  return (
    <motion.div
      key={record.id}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={index !== undefined ? { delay: Math.min(index * 0.03, 0.3) } : undefined}
      className={`group relative flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-lg border transition-all duration-150 ${
        isSelected
          ? 'bg-primary/10 border-primary/40 shadow-sm'
          : isIncome
            ? 'bg-success/5 dark:bg-success/10 border-success/20 hover:border-success/35'
            : 'bg-error/5 dark:bg-error/10 border-error/20 hover:border-error/35'
      }`}
    >
      {/* 左侧状态条 - 选中时更宽 */}
      <div className={`absolute left-0 top-0 bottom-0 rounded-l-lg ${
        isSelected
          ? 'w-2 bg-primary'
          : 'w-1.5'
      } ${isSelected ? '' : isIncome ? 'bg-success' : 'bg-error'}`} />

      {showBatchActions && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(record.id)}
          className="w-4 h-4 rounded border-border-primary accent-primary shrink-0"
        />
      )}

      <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center shrink-0 ${
        isIncome
          ? 'bg-success/20 dark:bg-success/30'
          : 'bg-error/20 dark:bg-error/30'
      }`}>
        {isIncome ? <TrendingUp size={18} className="text-success dark:text-success-400" /> : <TrendingDown size={18} className="text-error dark:text-error-400" />}
      </div>

      <div className="min-w-0 flex-1">
        <p className={`font-medium truncate ${isSelected ? 'text-primary' : 'text-text-primary'}`} title={record.description}>
          {truncatedDescription}
        </p>
        <div className="flex items-center gap-2 text-xs text-text-muted flex-wrap mt-1">
          <span className="badge badge-primary truncate max-w-[100px]" title={record.category}>{record.category}</span>
          {record.model && (
            <span className="text-text-secondary truncate max-w-[80px]" title={record.model}>{record.model}</span>
          )}
          <span className="flex items-center gap-1 shrink-0">
            <Calendar size={12} />
            {formatDisplayDate(record.date)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <span className={`text-lg font-semibold tabular-nums ${isIncome ? 'text-success dark:text-success-400' : 'text-error dark:text-error-400'}`}>
          {isIncome ? '+' : '-'}¥{record.amount.toLocaleString()}
        </span>
        <div className="flex gap-1 transition-opacity">
          <button
            onClick={() => onEdit(record)}
            className={`p-1.5 rounded-lg transition-all ${
              isSelected
                ? 'text-text-secondary hover:text-primary hover:bg-primary/10'
                : 'text-text-muted/60 hover:text-primary hover:bg-primary/10 opacity-60 group-hover:opacity-100'
            }`}
            title="编辑"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => onDelete(record.id)}
            className={`p-1.5 rounded-lg transition-all ${
              isSelected
                ? 'text-text-secondary hover:text-error hover:bg-error/10'
                : 'text-text-muted/60 hover:text-error hover:bg-error/10 opacity-60 group-hover:opacity-100'
            }`}
            title="删除"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};
