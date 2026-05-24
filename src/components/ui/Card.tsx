import React from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  variant?: 'default' | 'bordered' | 'elevated';
  hoverable?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  className?: string;
  children: React.ReactNode;
}

const Card: React.FC<CardProps> = ({
  variant = 'default',
  hoverable = false,
  padding = 'md',
  className = '',
  children,
}) => {
  const baseStyles = 'rounded-md bg-bg-card transition-all duration-200';

  const variantStyles = {
    default: 'shadow-card',
    bordered: 'border border-border-primary',
    elevated: 'shadow-md',
  };

  const paddingStyles = {
    none: '',
    sm: 'p-3 min-w-[240px]',
    md: 'p-4 md:p-5 min-w-[280px]',
    lg: 'p-5 md:p-6 min-w-[320px]',
  };

  const hoverStyles = hoverable
    ? 'hover:shadow-card-hover hover:-translate-y-0.5 cursor-pointer'
    : '';

  if (hoverable) {
    return (
      <motion.div
        whileHover={{ y: -2 }}
        className={`${baseStyles} ${variantStyles[variant]} ${paddingStyles[padding]} ${hoverStyles} ${className}`}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className={`${baseStyles} ${variantStyles[variant]} ${paddingStyles[padding]} ${className}`}>
      {children}
    </div>
  );
};

export default Card;