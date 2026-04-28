import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export const Layout: React.FC = () => {
  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 ml-64">
        <Header />
        <main className="flex-1 overflow-auto bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
