import React, { useState, useEffect, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PinLock } from './components/PinLock';
import ErrorBoundary from './components/ErrorBoundary';
import Loading from './components/Loading';
import { fetchPinStatus } from './lib/auth';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Tools = lazy(() => import('./pages/Tools'));
const Finance = lazy(() => import('./pages/Finance'));
const Settings = lazy(() => import('./pages/Settings'));

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingPin, setCheckingPin] = useState(true);
  const [pinCheckError, setPinCheckError] = useState<string | null>(null);

  const checkPinStatus = () => {
    setCheckingPin(true);
    setPinCheckError(null);
    fetchPinStatus()
      .then((status) => {
        if (!status.enabled) {
          setIsAuthenticated(true);
        }
        setPinCheckError(null);
      })
      .catch((err) => {
        // 安全原则：验证失败时应拒绝访问，而非放行
        setPinCheckError(err instanceof Error ? err.message : '无法验证 PIN 状态，请检查网络连接');
        // 不设置 isAuthenticated = true，保持默认拒绝
      })
      .finally(() => {
        setCheckingPin(false);
      });
  };

  useEffect(() => {
    checkPinStatus();
  }, []);

  const handlePinSuccess = () => {
    setIsAuthenticated(true);
  };

  if (checkingPin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (pinCheckError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-secondary">
        <div className="text-center p-8 bg-bg-primary rounded-lg shadow-lg max-w-md">
          <p className="text-error mb-4 text-lg">{pinCheckError}</p>
          <button
            onClick={checkPinStatus}
            className="px-4 py-2 bg-primary text-white rounded hover:bg-primary-hover transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <PinLock onSuccess={handlePinSuccess} />;
  }

  return (
    <ErrorBoundary>
      <HashRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="knowledge" element={<Knowledge />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="tools" element={<Tools />} />
              <Route path="finance" element={<Finance />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
