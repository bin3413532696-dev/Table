import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Calendar } from 'lucide-react';
import type { FinanceRecord } from '../../../db';

interface RecordFormProps {
  formData: Partial<FinanceRecord>;
  editingId: string | null;
  categories: { income: string[]; expense: string[] };
  models: string[];
  formErrors: { amount?: string; description?: string };
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  onDataChange: (data: Partial<FinanceRecord>) => void;
}

export const RecordForm: React.FC<RecordFormProps> = ({
  formData,
  editingId,
  categories,
  models,
  formErrors,
  onSubmit,
  onClose,
  onDataChange,
}) => {
  const formRef = useRef<HTMLFormElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => firstInputRef.current?.focus(), 50);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="rounded-xl p-6 w-full max-w-md bg-bg-card shadow-xl border border-border-primary"
      >
        <h2 className="text-lg font-semibold mb-5 text-text-primary">
          {editingId ? '编辑记录' : '添加记录'}
        </h2>
        <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onDataChange({ ...formData, type: 'expense' })}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                formData.type === 'expense'
                  ? 'bg-rose-500 text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              支出
            </button>
            <button
              type="button"
              onClick={() => onDataChange({ ...formData, type: 'income' })}
              className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                formData.type === 'income'
                  ? 'bg-emerald-500 text-white'
                  : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              收入
            </button>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">金额</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">¥</span>
              <input
                ref={firstInputRef}
                type="number"
                min="0.01"
                step="0.01"
                value={formData.amount || ''}
                onChange={e => {
                  const value = parseFloat(e.target.value);
                  onDataChange({ ...formData, amount: isNaN(value) ? 0 : Math.max(0, value) });
                  if (formErrors.amount) onDataChange({ ...formData, amount: isNaN(value) ? 0 : Math.max(0, value) });
                }}
                className={`w-full pl-8 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card text-text-primary ${
                  formErrors.amount ? 'border-rose-500' : 'border-border-primary'
                }`}
                placeholder="0.00"
                required
              />
            </div>
            {formErrors.amount && <p className="text-rose-500 text-xs mt-1">{formErrors.amount}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">
              描述 <span className="text-text-muted font-normal">(0/100)</span>
            </label>
            <input
              type="text"
              value={formData.description || ''}
              onChange={e => onDataChange({ ...formData, description: e.target.value.slice(0, 100) })}
              className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card text-text-primary ${
                formErrors.description ? 'border-rose-500' : 'border-border-primary'
              }`}
              placeholder="输入描述..."
              required
            />
            {formErrors.description && <p className="text-rose-500 text-xs mt-1">{formErrors.description}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">分类</label>
            <select
              value={formData.category || ''}
              onChange={e => onDataChange({ ...formData, category: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
            >
              <option value="">选择分类</option>
              {(categories[formData.type || 'expense'] || []).map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {formData.type === 'expense' && (
            <div>
              <label className="block text-sm font-medium mb-1.5 text-text-secondary">模型</label>
              <select
                value={formData.model || ''}
                onChange={e => onDataChange({ ...formData, model: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
              >
                <option value="">选择模型</option>
                {models.map(model => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">日期</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-text-muted" />
              <input
                type="date"
                value={formData.date || ''}
                onChange={e => onDataChange({ ...formData, date: e.target.value })}
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary"
                required
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 border rounded-lg transition-colors border-border-primary text-text-secondary hover:bg-bg-tertiary"
            >
              取消
            </button>
            <button
              type="submit"
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              {editingId ? '保存' : '添加'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};