import React from 'react';
import Button from './Button';

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  size?: 'sm' | 'md' | 'lg';
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  size = 'md',
}) => {
  const Icon = icon;

  const sizeStyles = {
    sm: {
      container: 'w-12 h-12',
      icon: 'w-6 h-6',
      title: 'text-sm',
      description: 'text-xs',
    },
    md: {
      container: 'w-16 h-16',
      icon: 'w-8 h-8',
      title: 'text-sm',
      description: 'text-xs',
    },
    lg: {
      container: 'w-20 h-20',
      icon: 'w-10 h-10',
      title: 'text-base',
      description: 'text-sm',
    },
  };

  const styles = sizeStyles[size];

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className={`${styles.container} rounded-full flex items-center justify-center bg-bg-tertiary mb-3`}>
        <Icon className={`${styles.icon} text-text-muted`} />
      </div>
      <p className={`${styles.title} text-text-secondary font-medium mb-1`}>{title}</p>
      {description && (
        <p className={`${styles.description} text-text-muted mb-3`}>{description}</p>
      )}
      {action && (
        <Button variant="primary" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
};

export default EmptyState;