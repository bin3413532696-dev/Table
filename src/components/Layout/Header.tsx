import React from 'react';
import { motion } from 'framer-motion';

export const Header: React.FC = () => {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="h-16 flex items-center justify-between px-6 sticky top-0 z-50 bg-bg-primary/80 backdrop-blur-xl border-b border-border-primary/50 shadow-sm"
    >
      <h1 className="text-lg font-semibold tracking-tight text-text-primary">个人工作站</h1>
    </motion.header>
  );
};