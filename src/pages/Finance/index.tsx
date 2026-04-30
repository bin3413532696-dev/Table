import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Download, Filter, X,
  CheckSquare, AlertTriangle, BarChart3, PieChart
} from 'lucide-react';
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, Legend
} from 'recharts';
import { financeDB, FinanceRecord, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';
import { Button, EmptyState } from '../../components/ui';
import { RecordItem, RecordForm, StatsCards } from './components';

const DEFAULT_CATEGORIES = {
  income: ['API调用收入', '服务收入', '其他收入'],
  expense: ['API调用费用', '模型订阅', '基础设施', '其他支出']
};

const DEFAULT_MODELS = ['GPT-4', 'GPT-3.5', 'Claude', 'Gemini', '其他'];
const CHART_COLORS = ['#165DFF', '#00B42A', '#FF7D00', '#F53F3F', '#757575', '#8B5CF6', '#06B6D4', '#84CC16'];

const useDB = createUseDB(React);

const MAX_DESCRIPTION_LENGTH = 100;

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
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
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

  const renderRecordItem = (record: FinanceRecord, index?: number) => (
    <RecordItem
      record={record}
      showBatchActions={showBatchActions}
      selectedIds={selectedIds}
      onToggleSelect={toggleSelect}
      onEdit={handleEdit}
      onDelete={handleDelete}
      index={index}
    />
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 md:mb-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-900 dark:bg-gray-700 rounded-lg flex items-center justify-center">
              <Wallet className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-text-primary">费用统计</h1>
              <p className="text-sm text-text-muted">大模型API投入与收入统计</p>
            </div>
          </div>
          <button onClick={exportToCSV} disabled={filteredRecords.length === 0} className="px-4 py-2 bg-bg-card border border-border-primary rounded-lg text-sm font-medium hover:bg-bg-tertiary transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <Download className="w-4 h-4" />
            导出 CSV
          </button>
        </div>
      </motion.div>

      <StatsCards stats={stats} />

      {records.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5 mb-6 md:mb-8">
          <div className="rounded-xl shadow-sm border p-4 md:p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-text-secondary" />
              <h2 className="text-base font-semibold text-text-primary">月度收支趋势</h2>
            </div>
            <div className="h-48 md:h-56">
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
          <div className="rounded-xl shadow-sm border p-4 md:p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-text-secondary" />
              <h2 className="text-base font-semibold text-text-primary">模型费用占比</h2>
            </div>
            <div className="h-48 md:h-56">
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

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-5">
        <div className="lg:col-span-2 rounded-xl shadow-sm border bg-bg-card border-border-primary">
          <div className="p-5 border-b border-border-primary">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {selectedIds.size > 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-muted">已选择 {selectedIds.size} 项</span>
                    <button onClick={() => setShowDeleteConfirm('batch')} className="px-3 py-1.5 bg-rose-500 text-white rounded-lg text-sm hover:bg-rose-600 transition-colors flex items-center gap-1"><Download className="w-4 h-4" />删除</button>
                    <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">取消</button>
                  </div>
                ) : (
                  <h2 className="text-base font-semibold text-text-primary">收支记录</h2>
                )}
              </div>
              <div className="flex gap-2">
                {filteredRecords.length > 0 && (
                  <button onClick={() => setShowBatchActions(!showBatchActions)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showBatchActions ? 'bg-primary-50 text-primary dark:bg-primary-900/20' : 'bg-bg-tertiary text-text-secondary hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}><CheckSquare className="w-4 h-4" />批量</button>
                )}
                <button onClick={() => setShowFilters(!showFilters)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showFilters || hasFilters ? 'bg-primary-50 text-primary dark:bg-primary-900/20' : 'bg-bg-tertiary text-text-secondary hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}><Filter className="w-4 h-4" />筛选</button>
                <Button variant="primary" size="sm" onClick={() => setShowForm(true)} icon={<Plus className="w-4 h-4" />}>添加</Button>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              {(['all', 'income', 'expense'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}>
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
              <EmptyState
                icon={Wallet}
                title="暂无记录"
                description='点击"添加"按钮创建第一条记录'
                action={{ label: '添加记录', onClick: () => setShowForm(true) }}
              />
            ) : filteredRecords.length > 20 ? (
              <VirtualList<FinanceRecord> items={filteredRecords} itemHeight={72} containerHeight={400} renderItem={renderRecordItem} />
            ) : (
              <>
                {showBatchActions && (
                  <div className="p-3 flex items-center gap-3 bg-bg-secondary border-b border-border-primary">
                    <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-border-primary accent-blue-500" />
                    <span className="text-sm text-text-muted">全选</span>
                  </div>
                )}
                <AnimatePresence>{filteredRecords.map((record, index) => renderRecordItem(record, index))}</AnimatePresence>
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
          <RecordForm
            formData={formData}
            editingId={editingId}
            categories={categories}
            models={models}
            formErrors={formErrors}
            onSubmit={handleSubmit}
            onClose={() => {
              setShowForm(false);
              setEditingId(null);
              setFormData({ type: 'expense', amount: 0, description: '', category: '', date: new Date().toISOString().split('T')[0], model: '' });
            }}
            onDataChange={setFormData}
          />
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
              <p className="text-text-secondary mb-5 text-sm">
                {showDeleteConfirm === 'batch'
                  ? `确定要删除选中的 ${selectedIds.size} 条记录吗？此操作无法撤销。`
                  : '确定要删除这条记录吗？此操作无法撤销。'}
              </p>
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