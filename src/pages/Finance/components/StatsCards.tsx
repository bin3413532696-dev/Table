import React from 'react';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { StatsCard, StatsCardGrid } from '../../../components/ui';
import type { StatsCardColor } from '../../../components/ui/StatsCard';

interface Stats {
  income: number;
  expense: number;
  profit: number;
}

interface StatsCardsProps {
  stats: Stats;
}

const formatCurrency = (value: number): { formatted: string; raw: string } => {
  if (value >= 1000000) {
    return { formatted: `¥${(value / 1000000).toFixed(1)}M`, raw: `¥${value.toLocaleString()}` };
  }
  if (value >= 1000) {
    return { formatted: `¥${(value / 1000).toFixed(1)}K`, raw: `¥${value.toLocaleString()}` };
  }
  return { formatted: `¥${value.toLocaleString()}`, raw: '' };
};

export const StatsCards: React.FC<StatsCardsProps> = ({ stats }) => {
  const incomeFormatted = formatCurrency(stats.income);
  const expenseFormatted = formatCurrency(stats.expense);
  const profitFormatted = formatCurrency(Math.abs(stats.profit));

  const profitColor: StatsCardColor = stats.profit >= 0 ? 'success' : 'error';
  const profitTrend: '+' | '' = stats.profit >= 0 ? '+' : '';

  const items = [
    {
      label: '总收入',
      value: stats.income,
      icon: TrendingUp,
      color: 'success' as const,
      trend: '+' as const,
      description: '本周期收入合计',
      formattedValue: incomeFormatted.formatted,
      rawValue: incomeFormatted.raw,
    },
    {
      label: '总支出',
      value: stats.expense,
      icon: TrendingDown,
      color: 'error' as const,
      trend: '-' as const,
      description: '本周期支出合计',
      formattedValue: expenseFormatted.formatted,
      rawValue: expenseFormatted.raw,
    },
    {
      label: '净收益',
      value: stats.profit,
      icon: DollarSign,
      color: profitColor,
      trend: profitTrend,
      description: '收入减去支出',
      formattedValue: profitFormatted.formatted,
      rawValue: stats.profit >= 1000 || stats.profit <= -1000 ? profitFormatted.raw : '',
    },
  ];

  return (
    <StatsCardGrid cols={3} className="mb-6">
      {items.map((item, i) => (
        <StatsCard
          key={item.label}
          label={item.label}
          value={item.value}
          icon={item.icon}
          color={item.color}
          trend={item.trend}
          description={item.description}
          formattedValue={item.formattedValue}
          rawValue={item.rawValue}
          index={i}
        />
      ))}
    </StatsCardGrid>
  );
};