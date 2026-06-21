import React, { Suspense, lazy } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Loading from '../components/Loading';
import { AppLayout } from './layout/AppLayout';

const DashboardPage = lazy(() => import('../features/dashboard/page'));
const KnowledgePage = lazy(() => import('../features/knowledge/page'));
const TasksPage = lazy(() => import('../features/tasks/page'));
const ToolsPage = lazy(() => import('../features/tools/page'));
const FinancePage = lazy(() => import('../features/finance/page'));
const SettingsPage = lazy(() => import('../features/settings/page'));
const AgentHistoryPage = lazy(() => import('../features/agent/page'));

export function AppRouter() {
  return (
    <HashRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="knowledge" element={<KnowledgePage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="tools" element={<ToolsPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="agent-history" element={<AgentHistoryPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </HashRouter>
  );
}
