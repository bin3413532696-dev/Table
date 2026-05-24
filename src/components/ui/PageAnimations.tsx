import React from 'react';
import { motion } from 'framer-motion';

// 统一动画配置
export const pageAnimations = {
  header: {
    initial: { opacity: 0, y: -12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] }
  },
  content: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, delay: 0.1, ease: [0.23, 1, 0.32, 1] }
  },
  card: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.25, delay: 0.1, ease: [0.23, 1, 0.32, 1] }
  }
};

// 统一缓动函数
export const defaultEasing = [0.23, 1, 0.32, 1] as const;

// 页面头部入场动画组件
export function PageHeader({
  children,
  className = '',
  delay = 0
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay,
        ease: defaultEasing
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// 页面内容入场动画组件
export function PageContent({
  children,
  className = '',
  delay = 0.1
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay,
        ease: defaultEasing
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Stagger 子元素动画容器
export function StaggerContainer({
  children,
  className = '',
  staggerDelay = 0.05
}: {
  children: React.ReactNode;
  className?: string;
  staggerDelay?: number;
}) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            duration: 0.3,
            staggerChildren: staggerDelay,
            ease: defaultEasing
          }
        }
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Stagger 子元素
export function StaggerItem({
  children,
  className = ''
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 }
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}