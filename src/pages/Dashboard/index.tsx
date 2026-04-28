import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, FileText, Wallet,
  TrendingUp, TrendingDown, ArrowRight, Clock,
  Calendar, AlertCircle, Zap
} from 'lucide-react';
import { financeDB, taskDB, noteDB } from '../../db';

interface DashboardStats {
  tasks: { total: number; completed: number; pending: number };
  notes: number;
  finance: { income: number; expense: number; profit: number };
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    tasks: { total: 0, completed: 0, pending: 0 },
    notes: 0,
    finance: { income: 0, expense: 0, profit: 0 }
  });
  const [recentNotes, setRecentNotes] = useState<any[]>([]);
  const [pendingTasks, setPendingTasks] = useState<any[]>([]);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    const taskStats = await taskDB.getStats();
    const notes = await noteDB.getAll();
    const financeStats = await financeDB.getStats();
    const tasks = await taskDB.getAll();

    setStats({
      tasks: taskStats,
      notes: notes.length,
      finance: financeStats
    });

    setRecentNotes(notes.slice(0, 3));
    setPendingTasks(tasks.filter(t => !t.completed).slice(0, 3));
  };

  const quickActions = [
    {
      icon: CheckSquare,
      label: '待办任务',
      count: stats.tasks.pending,
      color: 'from-blue-500 to-blue-600',
      bgColor: 'bg-gradient-to-br from-blue-50 to-blue-100/50',
      borderColor: 'border-blue-200',
      textColor: 'text-blue-600',
      path: '/tasks'
    },
    {
      icon: FileText,
      label: '笔记',
      count: stats.notes,
      color: 'from-violet-500 to-violet-600',
      bgColor: 'bg-gradient-to-br from-violet-50 to-violet-100/50',
      borderColor: 'border-violet-200',
      textColor: 'text-violet-600',
      path: '/notes'
    },
    {
      icon: Wallet,
      label: '净收益',
      count: `¥${stats.finance.profit.toLocaleString()}`,
      color: stats.finance.profit >= 0 ? 'from-emerald-500 to-emerald-600' : 'from-rose-500 to-rose-600',
      bgColor: stats.finance.profit >= 0
        ? 'bg-gradient-to-br from-emerald-50 to-emerald-100/50'
        : 'bg-gradient-to-br from-rose-50 to-rose-100/50',
      borderColor: stats.finance.profit >= 0 ? 'border-emerald-200' : 'border-rose-200',
      textColor: stats.finance.profit >= 0 ? 'text-emerald-600' : 'text-rose-600',
      path: '/finance'
    },
    {
      icon: Calendar,
      label: '今日',
      count: new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
      color: 'from-amber-500 to-amber-600',
      bgColor: 'bg-gradient-to-br from-amber-50 to-amber-100/50',
      borderColor: 'border-amber-200',
      textColor: 'text-amber-600',
      path: '/tasks'
    },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25">
            <LayoutDashboard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">个人工作台</h1>
            <p className="text-sm text-gray-500">
              {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
            </p>
          </div>
        </div>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8"
      >
        {quickActions.map((action) => (
          <motion.div
            key={action.label}
            variants={itemVariants}
            whileHover={{ y: -4, transition: { duration: 0.2 } }}
            onClick={() => navigate(action.path)}
            className={`${action.bgColor} rounded-2xl p-5 cursor-pointer group border ${action.borderColor} hover:shadow-xl transition-all duration-300 hover:shadow-blue-200/50`}
          >
            <div className={`w-12 h-12 bg-gradient-to-br ${action.color} rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform duration-300`}>
              <action.icon className="w-6 h-6 text-white" />
            </div>
            <p className={`text-sm font-medium mb-1 ${action.textColor}`}>{action.label}</p>
            <p className="text-2xl font-bold text-gray-900">{action.count}</p>
            <div className="flex items-center gap-1 mt-3 text-xs text-gray-500 group-hover:text-gray-700">
              <span>查看详情</span>
              <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
            </div>
          </motion.div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 rounded-2xl p-6 shadow-sm border bg-white border-gray-200"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-100">
                <AlertCircle className="w-4 h-4 text-amber-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">待办任务</h2>
            </div>
            <button
              onClick={() => navigate('/tasks')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 group"
            >
              查看全部
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {pendingTasks.length > 0 ? (
            <div className="space-y-3">
              {pendingTasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  whileHover={{ backgroundColor: 'rgba(243, 244, 246, 1)' }}
                  onClick={() => navigate('/tasks')}
                  className="flex items-center justify-between p-4 rounded-xl transition-all duration-200 cursor-pointer border border-gray-100 hover:border-gray-200 hover:shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    <span className="font-medium text-gray-800">{task.title}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-gray-100">
                <CheckSquare className="w-8 h-8 text-gray-300" />
              </div>
              <p>暂无待办任务</p>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl p-6 shadow-sm border bg-white border-gray-200"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-100">
                <Zap className="w-4 h-4 text-violet-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">最近笔记</h2>
            </div>
            <button
              onClick={() => navigate('/notes')}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 group"
            >
              查看全部
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          {recentNotes.length > 0 ? (
            <div className="space-y-3">
              {recentNotes.map((note, index) => (
                <motion.div
                  key={note.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                  whileHover={{ backgroundColor: 'rgba(243, 244, 246, 1)' }}
                  onClick={() => navigate('/notes')}
                  className="p-4 rounded-xl transition-all duration-200 cursor-pointer border border-gray-100 hover:border-gray-200 hover:shadow-sm"
                >
                  <h3 className="font-medium mb-1 truncate text-gray-800">{note.title}</h3>
                  <p className="text-sm line-clamp-2 text-gray-500">{note.content || '无内容'}</p>
                  <div className="flex items-center gap-1 text-xs mt-2 text-gray-400">
                    <Clock className="w-3 h-3" />
                    {new Date(note.updatedAt).toLocaleDateString()}
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-400">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center bg-gray-100">
                <FileText className="w-8 h-8 text-gray-300" />
              </div>
              <p>暂无笔记</p>
            </div>
          )}
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 bg-gradient-to-r from-blue-500 to-violet-500 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/25"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold mb-1">费用概览</h3>
            <p className="text-blue-100 text-sm">本月收支情况</p>
          </div>
          <button
            onClick={() => navigate('/finance')}
            className="px-4 py-2 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-medium transition-colors"
          >
            查看详情
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-emerald-300 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">收入</span>
            </div>
            <p className="text-xl font-bold">¥{stats.finance.income.toLocaleString()}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-rose-300 mb-1">
              <TrendingDown className="w-4 h-4" />
              <span className="text-sm">支出</span>
            </div>
            <p className="text-xl font-bold">¥{stats.finance.expense.toLocaleString()}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-white/70 mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-sm">净收益</span>
            </div>
            <p className={`text-xl font-bold ${stats.finance.profit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              ¥{stats.finance.profit.toLocaleString()}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
