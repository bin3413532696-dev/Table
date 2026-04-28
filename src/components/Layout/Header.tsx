import React from 'react';
import { Settings, User, Bell } from 'lucide-react';
import { motion } from 'framer-motion';

export const Header: React.FC = () => {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="h-16 flex items-center justify-between px-6 sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200/50 shadow-sm"
    >
      <h1 className="text-lg font-semibold tracking-tight text-gray-800">个人工作站</h1>
      <div className="flex items-center gap-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="p-2.5 rounded-lg transition-colors cursor-pointer hover:bg-gray-100 text-gray-600"
        >
          <Bell className="w-5 h-5" />
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="p-2.5 rounded-lg transition-colors cursor-pointer hover:bg-gray-100 text-gray-600"
        >
          <Settings className="w-5 h-5" />
        </motion.button>
        <motion.div
          whileHover={{ scale: 1.05 }}
          className="w-9 h-9 rounded-lg bg-gray-700 flex items-center justify-center cursor-pointer"
        >
          <User className="w-4 h-4 text-white" />
        </motion.div>
      </div>
    </motion.header>
  );
};
