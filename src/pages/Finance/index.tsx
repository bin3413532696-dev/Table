import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wallet, Plus, Download, Filter, X,
  CheckSquare, AlertTriangle, BarChart3, PieChart, Trash2
} from 'lucide-react';
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart as RechartsPie, Pie, Cell, Legend
} from 'recharts';
import { financeDB, FinanceRecord, createUseDB, getErrorMessage } from '../../db';
import Loading from '../../components/Loading';
import { VirtualList } from '../../components/VirtualList';
import { Button, EmptyState } from '../../components/ui';
import { RecordItem, RecordForm, FinanceOverview } from './components';
import { MESSAGES } from '../../core/messages';
import { PageHeader, PageContent, defaultEasing } from '../../components/ui/PageAnimations';

const DEFAULT_CATEGORIES = {
  income: ['API调用收入', '服务收入', '其他收入'],
  expense: ['API调用费用', '模型订阅', '基础设施', '其他支出']
};

const DEFAULT_MODELS = ['GPT-4', 'GPT-3.5', 'Claude', 'Gemini', '其他'];

const getChartColor = (index: number) => `var(--chart-${(index % 8) + 1})`;
const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'];

const useDB = createUseDB(React);

const MAX_DESCRIPTION_LENGTH = 100;

export default function Finance() {
  const { data: recordsData, loading, error: loadError } = useDB(() => financeDB.getAll(), ['finance']);
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

  const [formErrors, setFormErrors] = useState<{ amount?: string; description?: string; category?: string }>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchActions, setShowBatchActions] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'error'; message: string } | null>(null);

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
    filteredRecords.forEach(r => {
      const model = r.model || '其他';
      if (!stats[model]) stats[model] = { expense: 0, income: 0 };
      if (r.type === 'expense') stats[model].expense += r.amount;
      else stats[model].income += r.amount;
    });
    return stats;
  }, [filteredRecords]);

  const monthlyTrend = useMemo(() => {
    const monthMap = new Map<string, { income: number; expense: number }>();
    filteredRecords.forEach(r => {
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
  }, [filteredRecords]);

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
    filteredRecords.forEach(r => {
      const cat = r.category || '其他';
      if (!stats[cat]) stats[cat] = { income: 0, expense: 0 };
      if (r.type === 'income') stats[cat].income += r.amount;
      else stats[cat].expense += r.amount;
    });
    return stats;
  }, [filteredRecords]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { amount?: string; description?: string } = {};
    if (!formData.amount || formData.amount <= 0) errors.amount = '金额必须大于 0';
    if (!formData.description?.trim()) errors.description = '描述不能为空';
    else if (formData.description.length > MAX_DESCRIPTION_LENGTH) errors.description = `描述不能超过 ${MAX_DESCRIPTION_LENGTH} 字符`;
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    setFormErrors({});
    try {
      setFeedback(null);
      if (editingId) {
        const version = records.find((record) => record.id === editingId)?.version;
        if (version === undefined) {
          throw new Error(MESSAGES.common.versionConflict);
        }
        await financeDB.update(editingId, {
          ...formData,
          version,
        });
        setEditingId(null);
      } else {
        await financeDB.add({
          type: formData.type || 'expense',
          amount: Number(formData.amount),
          description: formData.description || '',
          category: formData.category || (formData.type === 'income' ? '其他收入' : '其他支出'),
          date: formData.date || new Date().toISOString().split('T')[0],
          model: formData.model,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }
      setShowForm(false);
      setFormData({ type: 'expense', amount: 0, description: '', category: '', date: new Date().toISOString().split('T')[0], model: '' });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getErrorMessage(error, MESSAGES.finance.saveFailed),
      });
    }
  };

  const handleEdit = (record: FinanceRecord) => {
    setFormData(record);
    setEditingId(record.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      setFeedback(null);
      await financeDB.delete(id);
      setShowDeleteConfirm(null);
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (error) {
      setFeedback({
        type: 'error',
        message: getErrorMessage(error, MESSAGES.finance.deleteFailed),
      });
    }
  };

  const handleBatchDelete = async () => {
    const results = await Promise.allSettled([...selectedIds].map(id => financeDB.delete(id)));
    const failedCount = results.filter((result) => result.status === 'rejected').length;
    if (failedCount > 0) {
      setBatchFeedback(`批量删除完成，但有 ${failedCount} 项删除失败。`);
    } else {
      setBatchFeedback('');
    }
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
    const escapeCSVField = (cell: string) => {
      if (cell.includes('"') || cell.includes(',') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    };
    const rows = filteredRecords.map(r => [
      r.date, r.type === 'income' ? '收入' : '支出', r.amount.toString(),
      r.description, r.category || '', r.model || ''
    ].map(escapeCSVField));
    const csvContent = [headers.join(','), rows.join('\n')].join('\n');
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
      onDelete={(id) => setShowDeleteConfirm(id)}
      index={index}
    />
  );

  return (
    <div className="p-3 md:p-6 min-h-screen bg-bg-secondary">
      <div className="max-w-6xl mx-auto space-y-4">
      <PageHeader className="mb-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="page-header-icon">
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
      </PageHeader>

      {batchFeedback && (
        <div className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          {batchFeedback}
        </div>
      )}

      {(loadError || feedback) && (
        <div className="rounded-lg border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">
          {feedback?.message || loadError}
        </div>
      )}

      {/* 统一的财务概览组件 */}
      <FinanceOverview stats={stats} />

      {records.length > 0 && (
        <PageContent delay={0.15} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl shadow-sm border p-4 md:p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-text-secondary" />
              <h2 className="text-sm font-medium text-text-primary">月度收支趋势</h2>
            </div>
            <div className="chart-height">
              {monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-primary)" />
                    <XAxis dataKey="month" stroke="var(--text-muted)" fontSize={11} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-primary)', borderRadius: '8px' }} labelStyle={{ color: 'var(--text-primary)' }} />
                    <Bar dataKey="income" name="收入" fill="var(--chart-positive)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expense" name="支出" fill="var(--chart-negative)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">暂无数据</div>
              )}
            </div>
          </div>
          <div className="rounded-xl shadow-sm border p-4 md:p-5 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="w-5 h-5 text-text-secondary" />
              <h2 className="text-sm font-medium text-text-primary">模型费用占比</h2>
            </div>
            <div className="chart-height">
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
                <div className="h-full flex flex-col items-center justify-center gap-3">
                  <PieChart className="w-10 h-10 text-text-muted/50" />
                  <p className="text-sm text-text-muted">暂无支出数据</p>
                  <button onClick={() => setShowForm(true)} className="text-sm text-primary hover:text-primary-dark transition-colors">添加支出记录</button>
                </div>
              )}
            </div>
          </div>
        </PageContent>
      )}

      <PageContent delay={0.2} className="grid-content-2-1 gap-5">
        <div className="lg:col-span-2 rounded-xl shadow-sm border bg-bg-card border-border-primary">
          <div className="p-5 border-b border-border-primary">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                {selectedIds.size > 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-muted">已选择 {selectedIds.size} 项</span>
                    <button onClick={() => setShowDeleteConfirm('batch')} className="px-3 py-1.5 bg-error text-white rounded-lg text-sm hover:bg-error-dark transition-colors flex items-center gap-1"><Trash2 className="w-4 h-4" />删除</button>
                    <button onClick={() => setSelectedIds(new Set())} className="px-3 py-1.5 bg-bg-tertiary rounded-lg text-sm hover:bg-bg-secondary transition-colors">取消</button>
                  </div>
                ) : (
                  <h2 className="text-base font-semibold text-text-primary">收支记录</h2>
                )}
              </div>
              <div className="flex gap-2">
                {filteredRecords.length > 0 && (
                  <button onClick={() => setShowBatchActions(!showBatchActions)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showBatchActions ? 'bg-primary-50 text-primary dark:bg-primary-900/20' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}><CheckSquare className="w-4 h-4" />批量</button>
                )}
                <button onClick={() => setShowFilters(!showFilters)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showFilters || hasFilters ? 'bg-primary-50 text-primary dark:bg-primary-900/20' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}><Filter className="w-4 h-4" />筛选</button>
                <Button variant="primary" size="sm" onClick={() => setShowForm(true)} icon={<Plus className="w-4 h-4" />}>添加</Button>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              {(['all', 'income', 'expense'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f ? 'bg-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}>
                  {f === 'all' ? '全部' : f === 'income' ? '收入' : '支出'}
                </button>
              ))}
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="rounded-lg p-4 space-y-3 bg-bg-secondary border border-border-primary mt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm mb-1.5 text-text-secondary font-medium">开始日期</label>
                      <input type="date" value={dateRange.start} onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })} className="input text-sm" />
                    </div>
                    <div>
                      <label className="block text-sm mb-1.5 text-text-secondary font-medium">结束日期</label>
                      <input type="date" value={dateRange.end} onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })} className="input text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm mb-1.5 text-text-secondary font-medium">模型筛选</label>
                    <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className="input text-sm">
                      <option value="">全部模型</option>
                      {models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {hasFilters && <button onClick={clearFilters} className="text-sm flex items-center gap-1 text-text-muted hover:text-primary transition-colors"><X className="w-4 h-4" />清除筛选</button>}
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
              <>
                {showBatchActions && (
                  <div className="p-3 flex items-center gap-3 bg-bg-secondary border-b border-border-primary sticky top-0 z-10">
                    <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-border-primary accent-primary" />
                    <span className="text-sm text-text-muted">全选 ({filteredRecords.length} 条记录)</span>
                  </div>
                )}
                <VirtualList<FinanceRecord> items={filteredRecords} itemHeight={72} containerHeight={480} renderItem={renderRecordItem} />
              </>
            ) : (
              <>
                {showBatchActions && (
                  <div className="p-3 flex items-center gap-3 bg-bg-secondary border-b border-border-primary">
                    <input type="checkbox" checked={isAllSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded border-border-primary accent-primary" />
                    <span className="text-sm text-text-muted">全选</span>
                  </div>
                )}
                <AnimatePresence>{filteredRecords.map((record, index) => renderRecordItem(record, index))}</AnimatePresence>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* 合并的统计卡片 - 模型和分类 */}
          <div className="rounded-lg shadow-md border p-4 bg-bg-card border-border-primary">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="w-4 h-4 text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">统计概览</h3>
            </div>

            {/* 模型统计 - 紧凑列表 */}
            <div className="mb-3">
              <p className="text-xs text-text-muted mb-2">按模型</p>
              <div className="space-y-1.5">
                {Object.entries(modelStats).slice(0, 5).map(([model, stat]) => (
                  <div key={model} className="flex items-center justify-between text-sm p-1.5 rounded bg-bg-secondary/50">
                    <span className="text-text-secondary truncate max-w-[80px]" title={model}>{model}</span>
                    <div className="flex gap-2 shrink-0">
                      {stat.income > 0 && <span className="text-success text-xs">+¥{stat.income.toLocaleString()}</span>}
                      {stat.expense > 0 && <span className="text-error text-xs">-¥{stat.expense.toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
                {Object.keys(modelStats).length === 0 && <p className="text-center py-3 text-text-muted text-xs">暂无数据</p>}
              </div>
            </div>

            {/* 分类统计 - 紧凑列表 */}
            <div>
              <p className="text-xs text-text-muted mb-2">按分类</p>
              <div className="space-y-1.5">
                {Object.entries(categoryStats).slice(0, 5).map(([cat, stat]) => (
                  <div key={cat} className="flex items-center justify-between text-sm p-1.5 rounded bg-bg-secondary/50">
                    <span className="text-text-secondary truncate max-w-[100px]" title={cat}>{cat}</span>
                    <div className="flex gap-2 shrink-0">
                      {stat.income > 0 && <span className="text-success text-xs">+¥{stat.income.toLocaleString()}</span>}
                      {stat.expense > 0 && <span className="text-error text-xs">-¥{stat.expense.toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
                {Object.keys(categoryStats).length === 0 && <p className="text-center py-3 text-text-muted text-xs">暂无数据</p>}
              </div>
            </div>
          </div>
        </div>
      </PageContent>

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
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="rounded-lg p-6 w-full max-w-sm bg-bg-card shadow-xl border border-border-primary">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-error-light dark:bg-error/20 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-error dark:text-error-400" />
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
                <button onClick={showDeleteConfirm === 'batch' ? handleBatchDelete : () => handleDelete(showDeleteConfirm)} className="flex-1 py-2 bg-error text-white rounded-lg hover:bg-error-dark transition-colors">删除</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
}
