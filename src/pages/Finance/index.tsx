import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, TrendingUp, TrendingDown, Plus, Trash2, Edit3, DollarSign,
  Calendar, PieChart, Filter, X, Download, BarChart3,
  CheckSquare, AlertTriangle, ChevronDown
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, Legend, BarChart, Bar
} from 'recharts';
import { financeDB, FinanceRecord, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';

const DEFAULT_CATEGORIES = {
  income: ['API调用收入', '服务收入', '其他收入'],
  expense: ['API调用费用', '模型订阅', '基础设施', '其他支出']
};

const DEFAULT_MODELS = ['GPT-4', 'GPT-3.5', 'Claude', 'Gemini', '其他'];

const MAX_DESCRIPTION_LENGTH = 100;

const CHART_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const useDB = createUseDB(React);

export default function Finance() {
  const { data: recordsData, loading } = useDB(() => financeDB.getAll(), ['finance']);
  const records = recordsData ?? [];
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [modelFilter, setModelFilter] = useState<string>('');
  const [formData, setFormData] = useState<Partial<FinanceRecord>>({
    type: 'expense',
    amount: 0,
    description: '',
    category: '',
    date: new Date().toISOString().split('T')[0],
    model: ''
  });
  const [formErrors, setFormErrors] = useState<{ amount?: string; description?: string }>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchActions, setShowBatchActions] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const categories = useMemo(() => {
    const incomeCats = new Set(DEFAULT_CATEGORIES.income);
    const expenseCats = new Set(DEFAULT_CATEGORIES.expense);
    records.forEach(r => {
      if (r.category) {
        if (r.type === 'income') incomeCats.add(r.category);
        else expenseCats.add(r.category);
      }
    });
    return { income: Array.from(incomeCats), expense: Array.from(expenseCats) };
  }, [records]);

  const models = useMemo(() => {
    const modelSet = new Set(DEFAULT_MODELS);
    records.forEach(r => { if (r.model) modelSet.add(r.model); });
    return Array.from(modelSet);
  }, [records]);

  useEffect(() => {
    if (showForm) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      setTimeout(() => { firstInputRef.current?.focus(); }, 50);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [showForm]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showForm || !formRef.current) return;
      if (e.key === 'Escape') { e.preventDefault(); setShowForm(false); return; }
      if (e.key === 'Tab') {
        const focusableElements = formRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusableElements.length === 0) return;
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
        if (e.shiftKey) {
          if (document.activeElement === firstElement) { e.preventDefault(); lastElement.focus(); }
        } else {
          if (document.activeElement === lastElement) { e.preventDefault(); firstElement.focus(); }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showForm]);

  const filteredRecords = useMemo(() => {
    let result = records;
    if (filter !== 'all') result = result.filter(r => r.type === filter);
    if (dateRange.start) result = result.filter(r => r.date >= dateRange.start);
    if (dateRange.end) result = result.filter(r => r.date <= dateRange.end);
    if (modelFilter) result = result.filter(r => r.model === modelFilter);
    return result;
  }, [records, filter, dateRange, modelFilter]);

  const stats = useMemo(() => {
    const income = filteredRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
    const expense = filteredRecords.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
    return { income, expense, profit: income - expense };
  }, [filteredRecords]);

  const modelStats = useMemo(() => {
    const stats: Record<string, { expense: number; income: number }> = {};
    records.forEach(r => {
      const model = r.model || '其他';
      if (!stats[model]) stats[model] = { expense: 0, income: 0 };
      if (r.type === 'expense') stats[model].expense += r.amount;
      else stats[model].income += r.amount;
    });
    return stats;
  }, [records]);

  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, { income: number; expense: number }>();
    records.forEach(r => {
      const month = r.date.slice(0, 7);
      if (!monthMap.has(month)) monthMap.set(month, { income: 0, expense: 0 });
      const data = monthMap.get(month)!;
      if (r.type === 'income') data.income += r.amount;
      else data.expense += r.amount;
    });
    return Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, data]) => ({
        month: month.slice(5),
        fullMonth: month,
        income: data.income,
        expense: data.expense,
        profit: data.income - data.expense
      }));
  }, [records]);

  const modelPieData = useMemo(() => {
    return Object.entries(modelStats)
      .filter(([, stat]) => stat.expense > 0)
      .map(([name, stat], index) => ({
        name,
        value: stat.expense,
        color: CHART_COLORS[index % CHART_COLORS.length]
      }));
  }, [modelStats]);

  const categoryStats = useMemo(() => {
    const stats: Record<string, { income: number; expense: number }> = {};
    records.forEach(r => {
      const cat = r.category || '其他';
      if (!stats[cat]) stats[cat] = { income: 0, expense: 0 };
      if (r.type === 'income') stats[cat].income += r.amount;
      else stats[cat].expense += r.amount;
    });
    return stats;
  }, [records]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { amount?: string; description?: string } = {};
    if (!formData.amount || formData.amount <= 0) errors.amount = '金额必须大于 0';
    if (!formData.description?.trim()) errors.description = '描述不能为空';
    else if (formData.description.length > MAX_DESCRIPTION_LENGTH) errors.description = `描述不能超过 ${MAX_DESCRIPTION_LENGTH} 字符`;
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    setFormErrors({});
    if (editingId) {
      await financeDB.update(editingId, formData);
      setEditingId(null);
    } else {
      await financeDB.add({
        type: formData.type || 'expense',
        amount: Number(formData.amount),
        description: formData.description || '',
        category: formData.category || (formData.type === 'income' ? '其他收入' : '其他支出'),
        date: formData.date || new Date().toISOString().split('T')[0],
        model: formData.model
      });
    }
    setShowForm(false);
    setFormData({ type: 'expense', amount: 0, description: '', category: '', date: new Date().toISOString().split('T')[0], model: '' });
  };

  const handleEdit = (record: FinanceRecord) => {
    setFormData(record);
    setEditingId(record.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await financeDB.delete(id);
    setShowDeleteConfirm(null);
    setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const handleBatchDelete = async () => {
    await Promise.all([...selectedIds].map(id => financeDB.delete(id)));
    setSelectedIds(new Set());
    setShowBatchActions(false);
    setShowDeleteConfirm(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRecords.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredRecords.map(r => r.id)));
  };

  const clearFilters = () => {
    setFilter('all');
    setDateRange({ start: '', end: '' });
    setModelFilter('');
  };

  const exportToCSV = () => {
    const headers = ['日期', '类型', '金额', '描述', '分类', '模型'];
    const rows = filteredRecords.map(r => [r.date, r.type === 'income' ? '收入' : '支出', r.amount.toString(), r.description, r.category || '', r.model || '']);
    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `财务记录_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <Loading />;

  const isAllSelected = selectedIds.size === filteredRecords.length && filteredRecords.length > 0;
  const hasFilters = filter !== 'all' || dateRange.start || dateRange.end || modelFilter;

  const recordItem = (record: FinanceRecord, index?: number) => (
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
          <input type="checkbox" checked={selectedIds.has(record.id)} onChange={() => toggleSelect(record.id)} className="w-4 h-4 rounded border-border-primary accent-blue-500" />
        )}
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${record.type === 'income' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'}`}>
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
        <span className={`text-lg font-semibold ${record.type === 'income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {record.type === 'income' ? '+' : '-'}¥{record.amount.toLocaleString()}
        </span>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => handleEdit(record)} className="p-2 rounded-lg transition-colors text-text-muted hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/20"><Edit3 size={16} /></button>
          <button onClick={() => setShowDeleteConfirm(record.id)} className="p-2 rounded-lg transition-colors text-text-muted hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"><Trash2 size={16} /></button>
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">费用统计</h1>
              <p className="text-sm text-text-muted">大模型API投入与收入统计</p>
            </div>
          </div>
          <button onClick={exportToCSV} disabled={filteredRecords.length === 0} className="px-4 py-2 bg-bg-card border border-border-primary rounded-lg text-sm font-medium hover:bg-bg-tertiary transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <Download className="w-4 h-4" />
            导出 CSV
          </button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        {[
          { label: '总收入', value: stats.income, icon: TrendingUp, color: 'emerald', prefix: '¥' },
          { label: '总支出', value: stats.expense, icon: TrendingDown, color: 'rose', prefix: '¥' },
          { label: '净收益', value: stats.profit, icon: DollarSign, color: stats.profit >= 0 ? 'emerald' : 'rose', prefix: stats.profit >= 0 ? '+¥' : '¥' },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            whileHover={{ y: -2 }}
            className="rounded-xl p-5 shadow-sm border bg-bg-card border-border-primary hover:shadow-md transition-all duration-200"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-text-secondary">{item.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.color === 'emerald' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-rose-100 dark:bg-rose-900/30'}`}>
                <item.icon className={`w-4 h-4 ${item.color === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} />
              </div>
            </div>
            <p className={`text-2xl font-bold ${item.color === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {item.prefix}{Math.abs(item.value).toLocaleString()}
            </p>
          </motion.div>
        ))}
      </motion.div>

      {records.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
          <div className="rounded-xl shadow-sm border p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-text-secondary" />
              <h2 className="text-base font-semibold text-text-primary">月度收支趋势</h2>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                  <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={11} />
                  <YAxis stroke="var(--text-muted)" fontSize={11} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: '8px' }} labelStyle={{ color: 'var(--text-primary)' }} />
                  <Bar dataKey="income" name="收入" fill="#10B981" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expense" name="支出" fill="#EF4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl shadow-sm border p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-text-secondary" />
              <h2 className="text-base font-semibold text-text-primary">模型费用占比</h2>
            </div>
            <div className="h-56">
              {modelPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie data={modelPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={2} dataKey="value">
                      {modelPieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: '8px' }} formatter={(value: number) => `¥${value.toLocaleString()}`} />
                    <Legend formatter={(value) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>} />
                  </RechartsPie>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">暂无支出数据</div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 rounded-xl shadow-sm border bg-bg-card border-border-primary">
          <div className="p-5 border-b border-border-primary">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {selectedIds.size > 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-muted">已选择 {selectedIds.size} 项</span>
                    <button onClick={() => setShowDeleteConfirm('batch')} className="px-3 py-1.5 bg-rose-500 text-white rounded-lg text-sm hover:bg-rose-600 transition-colors flex items-center gap-1"><Trash2 className="w-4 h-4" />删除</button>
                    <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">取消</button>
                  </div>
                ) : (
                  <h2 className="text-base font-semibold text-text-primary">收支记录</h2>
                )}
              </div>
              <div className="flex gap-2">
                {filteredRecords.length > 0 && (
                  <button onClick={() => setShowBatchActions(!showBatchActions)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showBatchActions ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'}`}><CheckSquare className="w-4 h-4" />批量</button>
                )}
                <button onClick={() => setShowFilters(!showFilters)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showFilters || hasFilters ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'}`}><Filter className="w-4 h-4" />筛选</button>
                <button onClick={() => setShowForm(true)} className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1 shadow-sm"><Plus className="w-4 h-4" />添加</button>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              {(['all', 'income', 'expense'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-gray-900 dark:bg-white dark:text-gray-900 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'}`}>
                  {f === 'all' ? '全部' : f === 'income' ? '收入' : '支出'}
                </button>
              ))}
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-lg p-4 space-y-3 bg-bg-secondary">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs mb-1 text-text-muted">开始日期</label>
                      <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary" />
                    </div>
                    <div>
                      <label className="block text-xs mb-1 text-text-muted">结束日期</label>
                      <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs mb-1 text-text-muted">模型筛选</label>
                    <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-bg-card border-border-primary">
                      <option value="">全部模型</option>
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {hasFilters && <button onClick={clearFilters} className="text-sm flex items-center gap-1 text-text-muted hover:text-text-secondary"><X className="w-3 h-3" />清除筛选</button>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="divide-y divide-border-primary min-h-[100px]">
            {filteredRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-2xl mb-4 flex items-center justify-center bg-bg-tertiary">
                  <Wallet className="w-8 h-8 text-text-muted" />
                </div>
                <p className="text-text-secondary font-medium mb-1">暂无记录</p>
                <p className="text-text-muted text-sm mb-4">点击"添加"按钮创建第一条记录</p>
                <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1"><Plus className="w-4 h-4" />添加记录</button>
              </div>
            ) : filteredRecords.length > 20 ? (
              <VirtualList<FinanceRecord> items={filteredRecords} itemHeight={72} containerHeight={400} renderItem={(record) => recordItem(record)} />
            ) : (
              <>
                {showBatchActions && (
                  <div className="p-3 flex items-center gap-3 bg-bg-secondary border-b border-border-primary">
                    <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-border-primary accent-blue-500" />
                    <span className="text-sm text-text-muted">全选</span>
                  </div>
                )}
                <AnimatePresence>{filteredRecords.map((record, index) => recordItem(record, index))}</AnimatePresence>
              </>
            )}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl shadow-sm border p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-text-secondary" />
              <h2 className="text-base font-semibold text-text-primary">模型统计</h2>
            </div>
            <div className="space-y-3">
              {Object.entries(modelStats).map(([model, stat]) => (
                <div key={model} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">{model}</span>
                  <div className="flex gap-3">
                    {stat.income > 0 && <span className="text-emerald-600 dark:text-emerald-400">+¥{stat.income.toLocaleString()}</span>}
                    <span className="text-rose-600 dark:text-rose-400">-¥{stat.expense.toLocaleString()}</span>
                  </div>
                </div>
              ))}
              {Object.keys(modelStats).length === 0 && <div className="text-center py-6 text-text-muted text-sm">暂无数据</div>}
            </div>
          </div>

          <div className="rounded-xl shadow-sm border p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-text-secondary" />
              <h2 className="text-base font-semibold text-text-primary">分类统计</h2>
            </div>
            <div className="space-y-3">
              {Object.entries(categoryStats).map(([cat, stat]) => (
                <div key={cat} className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary truncate max-w-[100px]">{cat}</span>
                  <div className="flex gap-3 shrink-0">
                    {stat.income > 0 && <span className="text-emerald-600 dark:text-emerald-400">+¥{stat.income.toLocaleString()}</span>}
                    {stat.expense > 0 && <span className="text-rose-600 dark:text-rose-400">-¥{stat.expense.toLocaleString()}</span>}
                  </div>
                </div>
              ))}
              {Object.keys(categoryStats).length === 0 && <div className="text-center py-6 text-text-muted text-sm">暂无数据</div>}
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowForm(false)}>
            <motion.div role="dialog" aria-modal="true" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} onClick={(e) => e.stopPropagation()} className="rounded-xl p-6 w-full max-w-md bg-bg-card shadow-xl border border-border-primary">
              <h2 className="text-lg font-semibold mb-5 text-text-primary">{editingId ? '编辑记录' : '添加记录'}</h2>
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFormData({ ...formData, type: 'expense' })} className={`flex-1 py-2 rounded-lg font-medium transition-colors ${formData.type === 'expense' ? 'bg-rose-500 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'}`}>支出</button>
                  <button type="button" onClick={() => setFormData({ ...formData, type: 'income' })} className={`flex-1 py-2 rounded-lg font-medium transition-colors ${formData.type === 'income' ? 'bg-emerald-500 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-gray-200 dark:hover:bg-gray-700'}`}>收入</button>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-text-secondary">金额</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">¥</span>
                    <input ref={firstInputRef} type="number" min="0.01" step="0.01" value={formData.amount || ''} onChange={(e) => { const value = parseFloat(e.target.value); setFormData({ ...formData, amount: isNaN(value) ? 0 : Math.max(0, value) }); if (formErrors.amount) setFormErrors({ ...formErrors, amount: undefined }); }} className={`w-full pl-8 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card text-text-primary ${formErrors.amount ? 'border-rose-500' : 'border-border-primary'}`} placeholder="0.00" required />
                  </div>
                  {formErrors.amount && <p className="text-rose-500 text-xs mt-1">{formErrors.amount}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-text-secondary">描述 <span className="text-text-muted font-normal">({formData.description?.length || 0}/{MAX_DESCRIPTION_LENGTH})</span></label>
                  <input type="text" value={formData.description || ''} onChange={(e) => { const value = e.target.value.slice(0, MAX_DESCRIPTION_LENGTH); setFormData({ ...formData, description: value }); if (formErrors.description) setFormErrors({ ...formErrors, description: undefined }); }} className={`w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card text-text-primary ${formErrors.description ? 'border-rose-500' : 'border-border-primary'}`} placeholder="输入描述..." required />
                  {formErrors.description && <p className="text-rose-500 text-xs mt-1">{formErrors.description}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-text-secondary">分类</label>
                  <select value={formData.category || ''} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary">
                    <option value="">选择分类</option>
                    {categories[formData.type || 'expense'].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                {formData.type === 'expense' && (
                  <div>
                    <label className="block text-sm font-medium mb-1.5 text-text-secondary">模型</label>
                    <select value={formData.model || ''} onChange={(e) => setFormData({ ...formData, model: e.target.value })} className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary">
                      <option value="">选择模型</option>
                      {models.map(model => <option key={model} value={model}>{model}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1.5 text-text-secondary">日期</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-text-muted" />
                    <input type="date" value={formData.date || ''} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-bg-card border-border-primary text-text-primary" required />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border rounded-lg transition-colors border-border-primary text-text-secondary hover:bg-bg-tertiary">取消</button>
                  <button type="submit" className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">{editingId ? '保存' : '添加'}</button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="rounded-xl p-6 w-full max-w-sm bg-bg-card shadow-xl border border-border-primary">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <h3 className="text-lg font-semibold text-text-primary">确认删除</h3>
              </div>
              <p className="text-text-secondary mb-5 text-sm">{showDeleteConfirm === 'batch' ? `确定要删除选中的 ${selectedIds.size} 条记录吗？此操作无法撤销。` : '确定要删除这条记录吗？此操作无法撤销。'}</p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteConfirm(null)} className="flex-1 py-2 border rounded-lg transition-colors border-border-primary text-text-secondary hover:bg-bg-tertiary">取消</button>
                <button onClick={showDeleteConfirm === 'batch' ? handleBatchDelete : () => handleDelete(showDeleteConfirm)} className="flex-1 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors">删除</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
