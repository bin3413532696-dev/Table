import React from 'react';
import { motion } from 'framer-motion';
import { ListTodo, CheckCircle, AlertCircle, AlertTriangle, Flag } from 'lucide-react';

interface Stats {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
}

interface TaskOverviewProps {
  stats: Stats;
  onFilterChange: (filter: 'all' | 'pending' | 'completed') => void;
}

export const TaskOverview: React.FC<TaskOverviewProps> = ({ stats, onFilterChange }) => {
  const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const StatItem = ({ 
    label, 
    value, 
    icon: Icon, 
    color, 
    onClick 
  }: { 
    label: string; 
    value: number; 
    icon: React.ElementType; 
    color: 'primary' | 'success' | 'warning' | 'error'; 
    onClick?: () => void;
  }) => (
    <motion.button
      whileHover={onClick ? { scale: 1.02, y: -1 } : {}}
      whileTap={onClick ? { scale: 0.98 } : {}}
      onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded-xl transition-all ${
        onClick ? 'cursor-pointer hover:bg-bg-tertiary/80' : ''
      }`}
    >
      <div className={`p-2.5 rounded-lg ${
        color === 'primary' ? 'bg-primary/10' :
        color === 'success' ? 'bg-success/10' :
        color === 'warning' ? 'bg-warning/10' :
        'bg-error/10'
      }`}>
        <Icon className={`w-5 h-5 ${
          color === 'primary' ? 'text-primary' :
          color === 'success' ? 'text-success' :
          color === 'warning' ? 'text-warning' :
          'text-error'
        }`} />
      </div>
      <div className="text-left">
        <p className="text-xs text-text-muted">{label}</p>
        <p className={`text-xl font-semibold ${
          color === 'primary' ? 'text-primary' :
          color === 'success' ? 'text-success' :
          color === 'warning' ? 'text-warning' :
          'text-error'
        }`}>{value}</p>
      </div>
    </motion.button>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-bg-card rounded-2xl border border-border-primary shadow-md overflow-hidden"
    >
      <div className="p-5 md:p-6">
        {/* 顶部进度条区域 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-medium text-text-primary">总体进度</h3>
            </div>
            <span className="text-sm font-semibold text-success">{completionRate}%</span>
          </div>
          
          {/* 进度条 */}
          <div className="h-2.5 bg-bg-tertiary rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${completionRate}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full bg-success rounded-full"
            />
          </div>
          
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-text-muted">已完成 {stats.completed}</span>
            <span className="text-xs text-text-muted">共 {stats.total}</span>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-border-primary mb-5" />

        {/* 四个统计项网格 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <StatItem
            label="总任务"
            value={stats.total}
            icon={ListTodo}
            color="primary"
            onClick={() => onFilterChange('all')}
          />
          <StatItem
            label="已完成"
            value={stats.completed}
            icon={CheckCircle}
            color="success"
            onClick={() => onFilterChange('completed')}
          />
          <StatItem
            label="待办"
            value={stats.pending}
            icon={AlertCircle}
            color="warning"
            onClick={() => onFilterChange('pending')}
          />
          <StatItem
            label="逾期"
            value={stats.overdue}
            icon={AlertTriangle}
            color="error"
          />
        </div>
      </div>
    </motion.div>
  );
};
