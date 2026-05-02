import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';

interface Stats {
  income: number;
  expense: number;
  profit: number;
}

interface StatsCardsProps {
  stats: Stats;
}

const formatCurrency = (value: number): string => {
  if (value >= 1000000) {
    return `¥${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `¥${(value / 1000).toFixed(1)}K`;
  }
  return `¥${value.toLocaleString()}`;
};

export const StatsCards: React.FC<StatsCardsProps> = ({ stats }) => {
  const items = [
    { label: '总收入', value: stats.income, icon: TrendingUp, color: 'success', trend: '+', desc: '本周期收入合计' },
    { label: '总支出', value: stats.expense, icon: TrendingDown, color: 'error', trend: '-', desc: '本周期支出合计' },
    { label: '净收益', value: stats.profit, icon: DollarSign, color: stats.profit >= 0 ? 'success' : 'error', trend: stats.profit >= 0 ? '+' : '', desc: '收入减去支出' },
  ];

  const colorConfig = {
    success: { bg: 'bg-success/10 dark:bg-success/20', iconBg: 'bg-success/20 dark:bg-success/30', text: 'text-success dark:text-success-400' },
    error: { bg: 'bg-error/10 dark:bg-error/20', iconBg: 'bg-error/20 dark:bg-error/30', text: 'text-error dark:text-error-400' },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-5 mb-6"
    >
      {items.map((item, i) => {
        const colors = colorConfig[item.color as 'success' | 'error'];
        return (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            whileHover={{ y: -2 }}
            className={`card cursor-pointer group ${colors.bg}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm text-text-secondary mb-1">{item.label}</p>
                <p className="text-xs text-text-muted">{item.desc}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl ${colors.iconBg} flex items-center justify-center group-hover:scale-105 transition-transform`}>
                <item.icon className={`w-5 h-5 ${colors.text}`} />
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={colors.text}>{item.trend}</span>
              <span className={`text-2xl font-bold tabular-nums ${colors.text}`}>
                {formatCurrency(Math.abs(item.value))}
              </span>
            </div>
            {item.value >= 1000 && (
              <p className="text-xs text-text-muted mt-1">
                = ¥{Math.abs(item.value).toLocaleString()}
              </p>
            )}
          </motion.div>
        );
      })}
    </motion.div>
  );
};