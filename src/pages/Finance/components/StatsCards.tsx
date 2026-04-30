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

export const StatsCards: React.FC<StatsCardsProps> = ({ stats }) => {
  const items = [
    { label: '总收入', value: stats.income, icon: TrendingUp, color: 'emerald', prefix: '¥' },
    { label: '总支出', value: stats.expense, icon: TrendingDown, color: 'rose', prefix: '¥' },
    { label: '净收益', value: stats.profit, icon: DollarSign, color: stats.profit >= 0 ? 'emerald' : 'rose', prefix: stats.profit >= 0 ? '+¥' : '¥' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-5"
    >
      {items.map((item, i) => (
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
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              item.color === 'emerald' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-rose-100 dark:bg-rose-900/30'
            }`}>
              <item.icon className={`w-4 h-4 ${
                item.color === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`} />
            </div>
          </div>
          <p className={`text-2xl font-bold ${
            item.color === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}>
            {item.prefix}{Math.abs(item.value).toLocaleString()}
          </p>
        </motion.div>
      ))}
    </motion.div>
  );
};