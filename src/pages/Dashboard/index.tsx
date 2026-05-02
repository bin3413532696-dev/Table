import React from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CheckSquare, Wallet,
  TrendingUp, TrendingDown, ArrowRight,
  Calendar, AlertCircle, Clock, Target
} from 'lucide-react';
import { financeDB, taskDB, Task, createUseDB } from '../../db';
import Loading from '../../components/Loading';
import { Button, EmptyState } from '../../components/ui';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } }
};

const useDB = createUseDB(React);

export default function Dashboard() {
  const navigate = useNavigate();

  const { data, loading } = useDB(async () => {
    const [taskStats, financeStats, tasks] = await Promise.all([
      taskDB.getStats(),
      financeDB.getStats(),
      taskDB.getAll()
    ]);
    return { taskStats, financeStats, tasks };
  }, ['tasks', 'finance']);

  const { taskStats, financeStats, tasks } = data ?? { taskStats: { total: 0, completed: 0, pending: 0 }, financeStats: { income: 0, expense: 0, profit: 0 }, tasks: [] };

  const pendingTasks = tasks.filter((t: Task) => !t.completed).slice(0, 5);

  // 统计卡片数据
  const statsCards = [
    {
      icon: CheckSquare,
      label: '待办任务',
      value: taskStats.pending,
      unit: '项',
      color: 'primary',
      trend: taskStats.total > 0 ? `${Math.round(taskStats.completed / taskStats.total * 100)}% 完成` : '暂无任务',
      path: '/tasks'
    },
    {
      icon: Wallet,
      label: '净收益',
      value: financeStats.profit,
      unit: '元',
      color: financeStats.profit >= 0 ? 'success' : 'error',
      trend: financeStats.income > 0 ? `收入 ¥${financeStats.income.toLocaleString()}` : '暂无收入',
      path: '/finance'
    },
    {
      icon: Calendar,
      label: '今日',
      value: new Date().getDate(),
      unit: new Date().toLocaleDateString('zh-CN', { month: 'long' }),
      color: 'info',
      trend: new Date().toLocaleDateString('zh-CN', { weekday: 'long' }),
      path: '/tasks'
    },
  ];

  if (loading) {
    return <Loading />;
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto min-h-screen bg-bg-secondary">
      {/* 页面头部 */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="page-header"
      >
        <div className="page-header-icon">
          <LayoutDashboard className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="page-header-title">个人工作台</h1>
          <p className="page-header-subtitle">
            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
      </motion.div>

      {/* 统计卡片区 */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 mb-6 md:mb-8"
      >
        {statsCards.map((card) => {
          const colorMap: Record<string, { bg: string; iconBg: string; text: string }> = {
            primary: { bg: 'bg-primary/10 dark:bg-primary/20', iconBg: 'bg-primary', text: 'text-primary dark:text-primary-400' },
            success: { bg: 'bg-success/10 dark:bg-success/20', iconBg: 'bg-success', text: 'text-success dark:text-success-400' },
            error: { bg: 'bg-error/10 dark:bg-error/20', iconBg: 'bg-error', text: 'text-error dark:text-error-400' },
            info: { bg: 'bg-info/10 dark:bg-info/20', iconBg: 'bg-info', text: 'text-info dark:text-info-400' },
          };
          const colors = colorMap[card.color];

          return (
            <motion.div
              key={card.label}
              variants={itemVariants}
              whileHover={{ y: -2 }}
              onClick={() => navigate(card.path)}
              className="card cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-4">
                <div className={`w-11 h-11 rounded-xl ${colors.bg} flex items-center justify-center`}>
                  <card.icon className={`w-5 h-5 ${colors.text}`} />
                </div>
                <ArrowRight className="w-4 h-4 text-text-muted group-hover:text-text-secondary group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="text-sm text-text-secondary mb-1">{card.label}</p>
              <div className="flex items-baseline gap-1">
                <span className={`text-3xl font-bold ${colors.text}`}>
                  {typeof card.value === 'number' && card.label !== '今日' ? card.value.toLocaleString() : card.value}
                </span>
                <span className="text-sm text-text-muted">{card.unit}</span>
              </div>
              <p className="text-xs text-text-muted mt-2">{card.trend}</p>
            </motion.div>
          );
        })}
      </motion.div>

      {/* 主内容区 */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
        {/* 待办任务 - 占 3 列 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="lg:col-span-3 card"
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                <Target className="w-4 h-4 text-primary dark:text-primary-400" />
              </div>
              <h2 className="text-base font-semibold text-text-primary">待办任务</h2>
              {taskStats.pending > 0 && (
                <span className="badge badge-primary">{taskStats.pending}</span>
              )}
            </div>
            <button
              onClick={() => navigate('/tasks')}
              className="btn btn-ghost btn-sm"
            >
              查看全部
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {pendingTasks.length > 0 ? (
            <div className="space-y-2">
              {pendingTasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.05 }}
                  onClick={() => navigate('/tasks')}
                  className="flex items-center justify-between p-3 rounded-lg border border-border-primary hover:bg-bg-tertiary hover:border-border-secondary cursor-pointer transition-all duration-150"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      task.priority === 'high' ? 'bg-error' :
                      task.priority === 'medium' ? 'bg-warning' : 'bg-success'
                    }`} />
                    <span className="text-sm text-text-primary truncate max-w-[200px] md:max-w-[300px]">{task.title}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {task.dueDate && (
                      <span className="text-xs text-text-muted flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(task.dueDate).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      task.priority === 'high' ? 'bg-error/10 text-error' :
                      task.priority === 'medium' ? 'bg-warning/10 text-warning' :
                      'bg-success/10 text-success'
                    }`}>
                      {task.priority === 'high' ? '高' : task.priority === 'medium' ? '中' : '低'}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CheckSquare}
              title="暂无待办任务"
              description="所有任务都已完成"
              action={{ label: '添加任务', onClick: () => navigate('/tasks') }}
            />
          )}
        </motion.div>

        {/* 费用概览 - 占 2 列 */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="lg:col-span-2 card"
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-success/10 dark:bg-success/20 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-success dark:text-success-400" />
              </div>
              <h2 className="text-base font-semibold text-text-primary">费用概览</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/finance')}>
              详情
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="space-y-3">
            {/* 收入 */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-success/5 dark:bg-success/10 border border-success/20">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-success dark:text-success-400" />
                <span className="text-sm text-text-secondary">收入</span>
              </div>
              <span className="text-lg font-semibold text-success dark:text-success-400">
                ¥{financeStats.income.toLocaleString()}
              </span>
            </div>

            {/* 支出 */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-error/5 dark:bg-error/10 border border-error/20">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-error dark:text-error-400" />
                <span className="text-sm text-text-secondary">支出</span>
              </div>
              <span className="text-lg font-semibold text-error dark:text-error-400">
                ¥{financeStats.expense.toLocaleString()}
              </span>
            </div>

            {/* 净收益 */}
            <div className={`flex items-center justify-between p-3 rounded-lg border ${
              financeStats.profit >= 0
                ? 'bg-success/5 dark:bg-success/10 border-success/20'
                : 'bg-error/5 dark:bg-error/10 border-error/20'
            }`}>
              <div className="flex items-center gap-2">
                <Wallet className={`w-4 h-4 ${financeStats.profit >= 0 ? 'text-success dark:text-success-400' : 'text-error dark:text-error-400'}`} />
                <span className="text-sm text-text-secondary">净收益</span>
              </div>
              <span className={`text-xl font-bold ${financeStats.profit >= 0 ? 'text-success dark:text-success-400' : 'text-error dark:text-error-400'}`}>
                ¥{financeStats.profit.toLocaleString()}
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}