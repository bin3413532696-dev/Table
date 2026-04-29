import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, FileText, Wallet,
  TrendingUp, TrendingDown, ArrowRight, Clock,
  Calendar, AlertCircle, Zap
} from 'lucide-react';
import { financeDB, taskDB, noteDB, Note, Task, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { Button, EmptyState } from '../../components/ui';

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

const useDB = createUseDB(React);

export default function Dashboard() {
  const navigate = useNavigate();

  const { data, loading } = useDB(async () => {
    const [taskStats, notes, financeStats, tasks] = await Promise.all([
      taskDB.getStats(),
      noteDB.getAll(),
      financeDB.getStats(),
      taskDB.getAll()
    ]);
    return { taskStats, notes, financeStats, tasks };
  }, ['tasks', 'notes', 'finance']);

  const { taskStats, notes, financeStats, tasks } = data ?? { taskStats: { total: 0, completed: 0, pending: 0 }, notes: [], financeStats: { income: 0, expense: 0, profit: 0 }, tasks: [] };

  const recentNotes = notes.slice(0, 3);
  const pendingTasks = tasks.filter((t: Task) => !t.completed).slice(0, 3);

  const quickActions = [
    {
      icon: CheckSquare,
      label: '待办任务',
      count: taskStats.pending,
      color: 'bg-primary',
      bgColor: 'bg-primary-50 dark:bg-primary-900/20',
      borderColor: 'border-primary-200 dark:border-primary-800',
      textColor: 'text-primary dark:text-primary-400',
      path: '/tasks'
    },
    {
      icon: FileText,
      label: '笔记',
      count: notes.length,
      color: 'bg-gray-600 dark:bg-gray-400',
      bgColor: 'bg-bg-secondary',
      borderColor: 'border-border-primary',
      textColor: 'text-text-secondary',
      path: '/notes'
    },
    {
      icon: Wallet,
      label: '净收益',
      count: `¥${financeStats.profit.toLocaleString()}`,
      color: financeStats.profit >= 0 ? 'bg-emerald-500' : 'bg-rose-500',
      bgColor: financeStats.profit >= 0
        ? 'bg-emerald-50 dark:bg-emerald-900/20'
        : 'bg-rose-50 dark:bg-rose-900/20',
      borderColor: financeStats.profit >= 0 ? 'border-emerald-200 dark:border-emerald-800' : 'border-rose-200 dark:border-rose-800',
      textColor: financeStats.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
      path: '/finance'
    },
    {
      icon: Calendar,
      label: '今日',
      count: new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
      color: 'bg-gray-500 dark:bg-gray-500',
      bgColor: 'bg-bg-secondary',
      borderColor: 'border-border-primary',
      textColor: 'text-text-secondary',
      path: '/tasks'
    },
  ];

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <LayoutDashboard className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-primary">个人工作台</h1>
              <p className="text-sm text-text-muted">
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
            whileHover={{ y: -2, transition: { duration: 0.2 } }}
            onClick={() => navigate(action.path)}
            className={`${action.bgColor} rounded-xl p-5 cursor-pointer group border ${action.borderColor} hover:shadow-md transition-all duration-200`}
          >
            <div className={`w-12 h-12 ${action.color} rounded-lg flex items-center justify-center mb-4`}>
              <action.icon className="w-6 h-6 text-white" />
            </div>
            <p className={`text-sm font-medium mb-1 ${action.textColor}`}>{action.label}</p>
            <p className="text-2xl font-bold text-text-primary">{action.count}</p>
            <div className="flex items-center gap-1 mt-3 text-xs text-text-muted group-hover:text-text-secondary">
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
          className="lg:col-span-2 rounded-2xl p-6 shadow-sm border bg-bg-card border-border-primary"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-100 dark:bg-amber-900/30">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300" />
              </div>
              <h2 className="text-lg font-bold text-text-primary">待办任务</h2>
            </div>
            <button
              onClick={() => navigate('/tasks')}
              className="text-sm text-primary hover:text-primary-600 font-medium flex items-center gap-1 group"
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
                  onClick={() => navigate('/tasks')}
                  className="flex items-center justify-between p-4 rounded-xl transition-colors duration-150 cursor-pointer border border-border-primary hover:bg-bg-tertiary hover:shadow-sm"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-2 h-2 bg-primary rounded-full"></div>
                    <span className="font-medium text-text-primary">{task.title}</span>
                  </div>
                  <span className="text-xs text-text-muted">
                    {new Date(task.createdAt).toLocaleDateString()}
                  </span>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CheckSquare}
              title="暂无待办任务"
              action={{ label: '添加任务', onClick: () => navigate('/tasks') }}
            />
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl p-6 shadow-sm border bg-bg-card border-border-primary"
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-100 dark:bg-violet-900/30">
                <Zap className="w-4 h-4 text-violet-600 dark:text-violet-300" />
              </div>
              <h2 className="text-lg font-bold text-text-primary">最近笔记</h2>
            </div>
            <button
              onClick={() => navigate('/notes')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium flex items-center gap-1 group"
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
                  onClick={() => navigate('/notes')}
                  className="p-4 rounded-xl transition-colors duration-150 cursor-pointer border border-border-primary hover:bg-bg-tertiary hover:shadow-sm"
                >
                  <h3 className="font-medium mb-1 truncate text-text-primary">{note.title}</h3>
                  <p className="text-sm line-clamp-2 text-text-muted">{note.content || '无内容'}</p>
                  <div className="flex items-center gap-1 text-xs mt-2 text-text-muted">
                    <Clock className="w-3 h-3" />
                    {new Date(note.updatedAt).toLocaleDateString()}
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={FileText}
              title="暂无笔记"
              action={{ label: '新建笔记', onClick: () => navigate('/notes') }}
            />
          )}
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 rounded-2xl p-6 text-text-primary shadow-sm border bg-bg-card"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold mb-1">费用概览</h3>
            <p className="text-sm text-text-muted">本月收支情况</p>
          </div>
          <Button variant="primary" onClick={() => navigate('/finance')}>
              查看详情
            </Button>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div className="bg-bg-secondary rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">收入</span>
            </div>
            <p className="text-xl font-bold">¥{financeStats.income.toLocaleString()}</p>
          </div>
          <div className="bg-bg-secondary rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-300 mb-1">
              <TrendingDown className="w-4 h-4" />
              <span className="text-sm">支出</span>
            </div>
            <p className="text-xl font-bold">¥{financeStats.expense.toLocaleString()}</p>
          </div>
          <div className="bg-bg-secondary rounded-xl p-4 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-text-muted mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-sm">净收益</span>
            </div>
            <p className={`text-xl font-bold ${financeStats.profit >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
              ¥{financeStats.profit.toLocaleString()}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
