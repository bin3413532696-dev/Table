import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface AgentSidebarState {
  isOpen: boolean;
}

interface AgentSidebarContextType {
  state: AgentSidebarState;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

const SIDEBAR_OPEN_KEY = 'agent_sidebar_open';
const DEFAULT_OPEN_LARGE_SCREEN = true;

export const AgentSidebarContext = createContext<AgentSidebarContextType | null>(null);

export function AgentSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(() => {
    // 默认：桌面端打开，移动端关闭
    if (typeof window === 'undefined') return DEFAULT_OPEN_LARGE_SCREEN;
    const stored = localStorage.getItem(SIDEBAR_OPEN_KEY);
    if (stored) return stored === 'true';
    return window.innerWidth >= 1024;
  });

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  // 持久化状态
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_OPEN_KEY, String(isOpen));
    }
  }, [isOpen]);

  // 全局快捷键 Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle, close, isOpen]);

  return (
    <AgentSidebarContext.Provider value={{ state: { isOpen }, toggle, open, close }}>
      {children}
    </AgentSidebarContext.Provider>
  );
}

export function useAgentSidebar() {
  const context = useContext(AgentSidebarContext);
  if (!context) {
    throw new Error('useAgentSidebar must be used within AgentSidebarProvider');
  }
  return context;
}