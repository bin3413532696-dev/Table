import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wallet, TrendingUp, TrendingDown, Plus, Trash2, Edit3, DollarSign, Calendar, PieChart, Filter, X } from 'lucide-react';
import { initDB, financeDB, FinanceRecord } from '../../db';

const categories = {
  income: ['API调用收入', '服务收入', '其他收入'],
  expense: ['API调用费用', '模型订阅', '基础设施', '其他支出']
};

const models = ['GPT-4', 'GPT-3.5', 'Claude', 'Gemini', '其他'];

export default function Finance() {
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [dbReady, setDbReady] = useState(false);
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

  useEffect(() => {
    initDB().then(() => {
      setDbReady(true);
      loadRecords();
    });
  }, []);

  const loadRecords = async () => {
    const data = await financeDB.getAll();
    setRecords(data);
  };

  const filteredRecords = useMemo(() => {
    let result = records;
    
    if (filter !== 'all') {
      result = result.filter(r => r.type === filter);
    }
    
    if (dateRange.start) {
      result = result.filter(r => r.date >= dateRange.start);
    }
    if (dateRange.end) {
      result = result.filter(r => r.date <= dateRange.end);
    }
    
    if (modelFilter) {
      result = result.filter(r => r.model === modelFilter);
    }
    
    return result;
  }, [records, filter, dateRange, modelFilter]);

  const stats = useMemo(() => {
    const income = filteredRecords.filter(r => r.type === 'income').reduce((sum, r) => sum + r.amount, 0);
    const expense = filteredRecords.filter(r => r.type === 'expense').reduce((sum, r) => sum + r.amount, 0);
    const profit = income - expense;
    return { income, expense, profit };
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amount || !formData.description) return;

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
    await loadRecords();
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
    await loadRecords();
  };

  const clearFilters = () => {
    setFilter('all');
    setDateRange({ start: '', end: '' });
    setModelFilter('');
  };

  if (!dbReady) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gray-900 rounded-lg flex items-center justify-center">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">费用统计</h1>
            <p className="text-sm text-gray-500">大模型API投入与收入统计</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-6 shadow-sm border bg-white border-gray-200"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-100">
              <TrendingUp className="w-5 h-5 text-gray-600" />
            </div>
            <span className="font-medium text-gray-600">总收入</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">¥{stats.income.toLocaleString()}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl p-6 shadow-sm border bg-white border-gray-200"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-100">
              <TrendingDown className="w-5 h-5 text-gray-600" />
            </div>
            <span className="font-medium text-gray-600">总支出</span>
          </div>
          <p className="text-3xl font-bold text-gray-900">¥{stats.expense.toLocaleString()}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className={`rounded-xl p-6 shadow-sm border bg-white border-gray-200`}
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gray-100">
              <DollarSign className={`w-5 h-5 text-gray-600`} />
            </div>
            <span className="font-medium text-gray-600">净收益</span>
          </div>
          <p className={`text-3xl font-bold text-gray-900`}>
            ¥{stats.profit.toLocaleString()}
          </p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl shadow-sm border bg-white border-gray-200"
          >
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">收支记录</h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1 ${showFilters ? 'bg-blue-500/20 text-blue-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    <Filter className="w-4 h-4" />
                    筛选
                  </button>
                  <button
                    onClick={() => setShowForm(true)}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-1 shadow-md shadow-blue-500/20"
                  >
                    <Plus className="w-4 h-4" />
                    添加
                  </button>
                </div>
              </div>

              <div className="flex gap-2 mb-4">
                {(['all', 'income', 'expense'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      filter === f
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f === 'all' ? '全部' : f === 'income' ? '收入' : '支出'}
                  </button>
                ))}
              </div>

              <AnimatePresence>
                {showFilters && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-xl p-4 space-y-3 bg-gray-50"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs mb-1 text-gray-500">开始日期</label>
                        <input
                          type="date"
                          value={dateRange.start}
                          onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white border-gray-200"
                        />
                      </div>
                      <div>
                        <label className="block text-xs mb-1 text-gray-500">结束日期</label>
                        <input
                          type="date"
                          value={dateRange.end}
                          onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                          className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white border-gray-200"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs mb-1 text-gray-500">模型筛选</label>
                      <select
                        value={modelFilter}
                        onChange={(e) => setModelFilter(e.target.value)}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm focus:outline-none focus:border-blue-500 bg-white border-gray-200"
                      >
                        <option value="">全部模型</option>
                        {models.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    {(dateRange.start || dateRange.end || modelFilter) && (
                      <button
                        onClick={clearFilters}
                        className="text-sm flex items-center gap-1 text-gray-500 hover:text-gray-700"
                      >
                        <X className="w-3 h-3" />
                        清除筛选
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="divide-y divide-gray-100">
              <AnimatePresence>
                {filteredRecords.map((record, index) => (
                  <motion.div
                    key={record.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-4 flex items-center justify-between transition-colors group hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        record.type === 'income' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                      }`}>
                        {record.type === 'income' ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{record.description}</p>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <span>{record.category}</span>
                          {record.model && <span className="text-gray-400">· {record.model}</span>}
                          <span className="text-gray-400">· {record.date}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={`text-lg font-bold ${record.type === 'income' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {record.type === 'income' ? '+' : '-'}¥{record.amount.toLocaleString()}
                      </span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleEdit(record)}
                          className="p-2 rounded-lg transition-colors text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                        >
                          <Edit3 size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(record.id)}
                          className="p-2 rounded-lg transition-colors text-gray-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        <div>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-xl shadow-sm border p-6 bg-white border-gray-200"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gray-100">
                <PieChart className="w-4 h-4 text-gray-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">模型统计</h2>
            </div>
            <div className="space-y-4">
              {Object.entries(modelStats).map(([model, stat]) => (
                <div key={model} className="flex items-center justify-between">
                  <span className="text-gray-600">{model}</span>
                  <div className="flex gap-4 text-sm">
                    <span className="text-emerald-600">+¥{stat.income}</span>
                    <span className="text-rose-600">-¥{stat.expense}</span>
                  </div>
                </div>
              ))}
              {Object.keys(modelStats).length === 0 && (
                <p className="text-center py-4 text-gray-400">暂无数据</p>
              )}
            </div>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => setShowForm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl p-6 w-full max-w-md bg-white shadow-xl"
            >
              <h2 className="text-xl font-bold mb-6 text-gray-900">
                {editingId ? '编辑记录' : '添加记录'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'expense' })}
                    className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                      formData.type === 'expense'
                        ? 'bg-rose-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    支出
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, type: 'income' })}
                    className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                      formData.type === 'income'
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    收入
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700">金额</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">¥</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.amount || ''}
                      onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-8 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
                      placeholder="0.00"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700">描述</label>
                  <input
                    type="text"
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
                    placeholder="输入描述..."
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700">分类</label>
                  <select
                    value={formData.category || ''}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
                  >
                    <option value="">选择分类</option>
                    {categories[formData.type || 'expense'].map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {formData.type === 'expense' && (
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">模型</label>
                    <select
                      value={formData.model || ''}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
                    >
                      <option value="">选择模型</option>
                      {models.map(model => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700">日期</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none text-gray-400" />
                    <input
                      type="date"
                      value={formData.date || ''}
                      onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                      className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white border-gray-200 text-gray-900"
                      required
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 py-2 border rounded-lg transition-colors border-gray-200 text-gray-700 hover:bg-gray-100"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/20"
                  >
                    {editingId ? '保存' : '添加'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
