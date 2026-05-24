import React from 'react';
import { motion } from 'framer-motion';
import { StaggerItem } from './PageAnimations';

export type StatsCardColor = 'primary' | 'success' | 'warning' | 'error' | 'neutral';

interface StatsCardProps {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color?: StatsCardColor;
  onClick?: () => void;
  description?: string;
  trend?: '+' | '-' | '';
  formattedValue?: string;
  rawValue?: string;
  index?: number;
}

const COLOR_CONFIG: Record<StatsCardColor, {
  bg: string;
  iconBg: string;
  text: string;
  hoverBorder: string;
  border: string;
}> = {
  primary: {
    bg: 'bg-primary/8 dark:bg-primary/15',
    iconBg: 'bg-primary/15 dark:bg-primary/25',
    text: 'text-primary dark:text-primary-400',
    hoverBorder: 'hover:border-primary/40',
    border: 'border-primary/20',
  },
  success: {
    bg: 'bg-success/8 dark:bg-success/15',
    iconBg: 'bg-success/15 dark:bg-success/25',
    text: 'text-success dark:text-success-400',
    hoverBorder: 'hover:border-success/40',
    border: 'border-success/20',
  },
  warning: {
    bg: 'bg-warning/8 dark:bg-warning/15',
    iconBg: 'bg-warning/15 dark:bg-warning/25',
    text: 'text-warning dark:text-warning-400',
    hoverBorder: 'hover:border-warning/40',
    border: 'border-warning/20',
  },
  error: {
    bg: 'bg-error/8 dark:bg-error/15',
    iconBg: 'bg-error/15 dark:bg-error/25',
    text: 'text-error dark:text-error-400',
    hoverBorder: 'hover:border-error/40',
    border: 'border-error/20',
  },
  neutral: {
    bg: '',
    iconBg: 'bg-bg-tertiary',
    text: 'text-text-primary',
    hoverBorder: 'hover:border-border-secondary',
    border: 'border-border-primary',
  },
};

export function StatsCard({
  label,
  value,
  icon: IconComponent,
  color = 'neutral',
  onClick,
  description,
  trend = '',
  formattedValue,
  rawValue,
  index = 0,
}: StatsCardProps) {
  const config = COLOR_CONFIG[color];
  const displayValue = formattedValue ?? (typeof value === 'number' ? value.toLocaleString() : value);

  return (
    <StaggerItem
      className={`stat-card group rounded-lg border ${config.border} ${config.bg} ${config.hoverBorder} ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      <motion.div
        whileHover={onClick ? { y: -2 } : undefined}
        transition={{ duration: 0.15 }}
        onClick={onClick}
        className="flex items-start justify-between mb-3"
      >
        <div>
          <p className="stat-card-label mb-1">{label}</p>
          {description && (
            <p className="text-xs text-text-muted">{description}</p>
          )}
        </div>
        <div className={`stat-card-icon ${config.iconBg} group-hover:scale-105 transition-transform`}>
          <IconComponent className={`w-5 h-5 ${config.text}`} />
        </div>
      </motion.div>

      <div className="flex items-baseline gap-1">
        {trend && <span className={config.text}>{trend}</span>}
        <span className={`stat-card-value font-semibold ${config.text}`}>
          {displayValue}
        </span>
      </div>

      {rawValue && (
        <p className="text-xs text-text-muted mt-1">= {rawValue}</p>
      )}
    </StaggerItem>
  );
}

export function StatsCardGrid({
  children,
  cols = 4,
  className = '',
}: {
  children: React.ReactNode;
  cols?: 3 | 4;
  className?: string;
}) {
  const gridClass = cols === 3 ? 'grid-stats-3' : 'grid-stats-4';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className={`${gridClass} ${className}`}
    >
      {children}
    </motion.div>
  );
}