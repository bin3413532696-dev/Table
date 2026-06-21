import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, CheckSquare, Calendar, Settings, Wallet, Menu, X, Network } from 'lucide-react';
import { useCurrentUser } from '../../contexts/UserContext';

const menuItems = [
  { path: '/dashboard', icon: Home, label: '首页' },
  { path: '/knowledge', icon: Network, label: '知识库' },
  { path: '/tasks', icon: CheckSquare, label: '任务' },
  { path: '/finance', icon: Wallet, label: '费用统计' },
  { path: '/tools', icon: Calendar, label: '工具' },
  { path: '/settings', icon: Settings, label: '设置' },
];

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { user, auth } = useCurrentUser();
  const displayName = user?.displayName || '个人用户';
  const displayStatus = auth?.isDefaultUser ? '默认本地用户' : (user?.bio || '在线');

  // 监听窗口大小，移动端自动折叠
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <>
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setCollapsed(true)}
          />
        )}
      </AnimatePresence>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-bg-card border border-border-primary shadow-sm md:hidden"
      >
        {collapsed ? <Menu size={20} className="text-text-primary" /> : <X size={20} className="text-text-primary" />}
      </button>

      <motion.aside
        animate={{ width: collapsed ? 0 : 256, x: collapsed ? -256 : 0 }}
        transition={{ duration: 0.2 }}
        className="h-screen flex flex-col fixed left-0 top-0 z-50 bg-bg-card overflow-hidden border-r border-border-primary"
        style={{ minWidth: collapsed ? 0 : 256 }}
      >
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="p-6 border-b border-border-primary"
        >
          <h1 className="text-xl font-bold flex items-center gap-3 text-text-primary">
            <motion.div
              whileHover={{ scale: 1.05 }}
              className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center"
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
                  onClick={() => window.innerWidth < 768 && setCollapsed(true)}
                  className="relative flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 group"
                >
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute inset-0 bg-primary rounded-lg"
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  <span className={`relative z-10 transition-colors duration-200 ${isActive ? 'text-white' : 'text-text-secondary'}`}>
                    <item.icon size={20} />
                  </span>
                  <span className={`relative z-10 font-medium transition-colors duration-200 ${isActive ? 'text-white' : 'text-text-secondary'}`}>
                    {item.label}
                  </span>
                  {!isActive && (
                    <motion.div
                      className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-colors duration-200 bg-bg-tertiary"
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
          className="p-4 border-t border-border-primary"
        >
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-bg-tertiary">
            <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-white">{displayName.charAt(0)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-text-primary">{displayName}</p>
              <p className="text-xs truncate text-text-muted">{displayStatus}</p>
            </div>
          </div>
        </motion.div>
      </motion.aside>
    </>
  );
};
