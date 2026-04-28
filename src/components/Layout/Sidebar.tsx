import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, CheckSquare, FileText, Calendar, Settings, Wallet } from 'lucide-react';

const menuItems = [
  { path: '/dashboard', icon: Home, label: '首页' },
  { path: '/tasks', icon: CheckSquare, label: '任务' },
  { path: '/notes', icon: FileText, label: '笔记' },
  { path: '/finance', icon: Wallet, label: '费用统计' },
  { path: '/tools', icon: Calendar, label: '工具' },
  { path: '/settings', icon: Settings, label: '设置' },
];

export const Sidebar: React.FC = () => {
  const location = useLocation();

  return (
    <aside className="w-64 h-screen flex flex-col fixed left-0 top-0 z-50 bg-[#18181B]">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="p-6 border-b border-[#3F3F46]/50"
      >
        <h1 className="text-xl font-bold flex items-center gap-3 text-white">
          <motion.div
            whileHover={{ scale: 1.05, rotate: 5 }}
            className="w-10 h-10 bg-gradient-to-br from-[#2563EB] to-[#3B82F6] rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20"
          >
            <span className="text-white font-bold text-lg">W</span>
          </motion.div>
          <span className="tracking-tight">工作站</span>
        </h1>
      </motion.div>

      <nav className="flex-1 p-4 space-y-1">
        {menuItems.map((item, index) => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          return (
            <motion.div
              key={item.path}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.05 }}
            >
              <NavLink
                to={item.path}
                className="relative flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group"
              >
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className="absolute inset-0 bg-[#2563EB] rounded-xl"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}
                <span className={`relative z-10 transition-colors duration-200 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}`}>
                  <item.icon size={20} />
                </span>
                <span className={`relative z-10 font-medium transition-colors duration-200 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'}`}>
                  {item.label}
                </span>
                {!isActive && (
                  <motion.div
                    className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-colors duration-200 bg-[#3F3F46]/50"
                    transition={{ duration: 0.2 }}
                  />
                )}
              </NavLink>
            </motion.div>
          );
        })}
      </nav>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="p-4 border-t border-[#3F3F46]/50"
      >
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#3F3F46]/30">
          <div className="w-9 h-9 bg-gradient-to-br from-[#2563EB] to-purple-600 rounded-full flex items-center justify-center">
            <span className="text-sm font-medium text-white">我</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate text-white">个人用户</p>
            <p className="text-xs truncate text-gray-500">在线</p>
          </div>
        </div>
      </motion.div>
    </aside>
  );
};
