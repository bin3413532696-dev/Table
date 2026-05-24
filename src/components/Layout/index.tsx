import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export const Layout: React.FC = () => {
  return (
    <div className="min-h-screen flex bg-bg-secondary">
      <Sidebar />
      <main className="flex-1 min-w-0 md:ml-64">
        <Outlet />
      </main>
    </div>
  );
};
