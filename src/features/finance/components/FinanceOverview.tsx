import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, DollarSign, Wallet } from 'lucide-react';

interface Stats {
  income: number;
  expense: number;
  profit: number;
}

interface FinanceOverviewProps {
  stats: Stats;
}

export const FinanceOverview: React.FC<FinanceOverviewProps> = ({ stats }) => {
  const isProfitable = stats.profit >= 0;
  const profitRate = stats.income > 0 ? Math.round((stats.profit / stats.income) * 100) : 0;

  const formatCurrency = (value: number): string => {
    if (value >= 1000000) {
      return `¥${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `¥${(value / 1000).toFixed(1)}K`;
    }
    return `¥${value.toLocaleString()}`;
  };

  const StatItem = ({ 
    label, 
    value, 
    icon: Icon, 
    color, 
    description,
    trend 
  }: { 
    label: string; 
    value: number; 
    icon: React.ElementType; 
    color: 'primary' | 'success' | 'warning' | 'error'; 
    description?: string;
    trend?: '+' | '-';
  }) => (
    <div className="flex items-center gap-3 p-3 rounded-xl">
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
        <div className="flex items-baseline gap-1">
          {trend && <span className={`text-sm ${
            color === 'success' ? 'text-success' : 'text-error'
          }`}>{trend}</span>}
          <p className={`text-xl font-semibold ${
            color === 'primary' ? 'text-primary' :
            color === 'success' ? 'text-success' :
            color === 'warning' ? 'text-warning' :
            'text-error'
          }`}>{formatCurrency(value)}</p>
        </div>
        {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="bg-bg-card rounded-2xl border border-border-primary shadow-md overflow-hidden"
    >
      <div className="p-5 md:p-6">
        {/* 顶部主指标区域 */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-medium text-text-primary">财务概览</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-semibold ${isProfitable ? 'text-success' : 'text-error'}`}>
                {isProfitable ? '+' : ''}{profitRate}%
              </span>
              <span className="text-xs text-text-muted">收益率</span>
            </div>
          </div>
          
          {/* 收支对比进度条 */}
          <div className="h-2.5 bg-bg-tertiary rounded-full overflow-hidden flex">
            {stats.income > 0 && (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(stats.income / (stats.income + stats.expense || 1)) * 100}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
                className="h-full bg-success"
              />
            )}
            {stats.expense > 0 && (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(stats.expense / (stats.income + stats.expense || 1)) * 100}%` }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
                className="h-full bg-error"
              />
            )}
          </div>
          
          <div className="flex justify-between mt-1.5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-success" />
              <span className="text-xs text-text-muted">收入 {formatCurrency(stats.income)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-error" />
              <span className="text-xs text-text-muted">支出 {formatCurrency(stats.expense)}</span>
            </div>
          </div>
        </div>

        {/* 分隔线 */}
        <div className="h-px bg-border-primary mb-5" />

        {/* 三个统计项网格 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <StatItem
            label="总收入"
            value={stats.income}
            icon={TrendingUp}
            color="success"
            trend="+"
            description="本周期收入合计"
          />
          <StatItem
            label="总支出"
            value={stats.expense}
            icon={TrendingDown}
            color="error"
            trend="-"
            description="本周期支出合计"
          />
          <StatItem
            label="净收益"
            value={Math.abs(stats.profit)}
            icon={DollarSign}
            color={isProfitable ? 'success' : 'error'}
            trend={isProfitable ? '+' : '-'}
            description="收入减去支出"
          />
        </div>
      </div>
    </motion.div>
  );
};
