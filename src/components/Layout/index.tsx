import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AgentSidebar } from '../Agent/AgentSidebar';
import { useAgentSidebar } from '../../agent/AgentSidebarContext';

export const Layout: React.FC = () => {
  const { state: sidebarState } = useAgentSidebar();

  return (
    <div className="min-h-screen flex bg-bg-secondary">
      <Sidebar />
      <div className={`flex-1 flex flex-col min-w-0 md:ml-64 ${sidebarState.isOpen ? 'lg:mr-[384px]' : ''}`}>
        <Header />
        <main className="flex-1 overflow-auto bg-bg-secondary">
          <Outlet />
        </main>
      </div>
      <AgentSidebar />
    </div>
  );
};
