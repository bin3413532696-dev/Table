import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Edit3, Trash2 } from 'lucide-react';
import type { FinanceRecord } from '../../../db';

interface RecordItemProps {
  record: FinanceRecord;
  showBatchActions: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (record: FinanceRecord) => void;
  onDelete: (id: string) => void;
  index?: number;
}

export const RecordItem: React.FC<RecordItemProps> = ({
  record,
  showBatchActions,
  selectedIds,
  onToggleSelect,
  onEdit,
  onDelete,
  index
}) => {
  return (
    <motion.div
      key={record.id}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={index !== undefined ? { delay: index * 0.05 } : undefined}
      className="p-4 flex items-center justify-between transition-colors group hover:bg-bg-secondary"
    >
      <div className="flex items-center gap-4">
        {showBatchActions && (
          <input
            type="checkbox"
            checked={selectedIds.has(record.id)}
            onChange={() => onToggleSelect(record.id)}
            className="w-4 h-4 rounded border-border-primary accent-primary"
          />
        )}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
          record.type === 'income'
            ? 'bg-success-light text-success dark:bg-success dark:text-success'
            : 'bg-error-light text-error dark:bg-error dark:text-error'
        }`}>
          {record.type === 'income' ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
        </div>
        <div>
          <p className="font-medium text-text-primary">{record.description}</p>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span>{record.category}</span>
            {record.model && <span>· {record.model}</span>}
            <span>· {record.date}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className={`text-lg font-semibold ${
          record.type === 'income'
            ? 'text-success'
            : 'text-error'
        }`}>
          {record.type === 'income' ? '+' : '-'}¥{record.amount.toLocaleString()}
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(record)}
            className="p-2 rounded-lg transition-colors text-text-muted hover:text-primary hover:bg-primary-50 dark:hover:bg-primary-900/20"
          >
            <Edit3 size={16} />
          </button>
          <button
            onClick={() => onDelete(record.id)}
            className="p-2 rounded-lg transition-colors text-text-muted hover:text-error hover:bg-error-light dark:hover:bg-error/20"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};