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
  const baseStyles = 'inline-flex items-center justify-center font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed';

  const variantStyles = {
    primary: 'bg-primary text-white hover:bg-primary-600 active:bg-primary-700',
    secondary: 'bg-bg-card border border-primary text-primary hover:bg-primary-50 dark:hover:bg-primary-900/20',
    ghost: 'text-primary hover:bg-primary-50 dark:hover:bg-primary-900/20',
    danger: 'bg-error text-white hover:bg-error-dark',
    success: 'bg-success text-white hover:bg-success-dark',
  };

  const sizeStyles = {
    sm: 'px-2 py-1 text-xs rounded gap-1',
    md: 'px-4 py-2 text-sm rounded-md gap-1.5',
    lg: 'px-6 py-2.5 text-base rounded-lg gap-2',
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