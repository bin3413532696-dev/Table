import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  children,
  className = '',
  onClick,
  type = 'button',
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';

  const variantStyles = {
    primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] focus:ring-[var(--color-primary)]/20',
    secondary: 'bg-[var(--bg-card)] border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-secondary)] focus:ring-[var(--color-primary)]/20',
    ghost: 'text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] focus:ring-[var(--color-primary)]/20',
    danger: 'bg-[var(--color-error)] text-white hover:bg-[var(--color-error-dark)] focus:ring-[var(--color-error)]/20',
    success: 'bg-[var(--color-success)] text-white hover:bg-[var(--color-success-dark)] focus:ring-[var(--color-success)]/20',
  };

  const sizeStyles = {
    sm: 'px-2 py-1 text-xs rounded gap-1 min-w-[60px]',
    md: 'px-3 py-2 md:px-4 md:py-2.5 text-sm rounded-[6px] gap-1.5 min-w-[80px]',
    lg: 'px-4 py-2 md:px-6 md:py-3 text-sm md:text-base rounded-[6px] gap-2 min-w-[100px]',
  };

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      disabled={disabled || loading}
      onClick={onClick}
      type={type}
    >
      {loading ? (
        <span className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
      ) : icon}
      {children}
    </motion.button>
  );
};

export default Button;