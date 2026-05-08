import React, { useState, useEffect, Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { PinLock } from './components/PinLock';
import { AgentTrigger } from './components/Agent';
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

  useEffect(() => {
    fetchPinStatus()
      .then((status) => {
        if (!status.enabled) {
          setIsAuthenticated(true);
        }
      })
      .catch(() => {
        setIsAuthenticated(true);
      })
      .finally(() => {
        setCheckingPin(false);
      });
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
      <AgentTrigger />
    </ErrorBoundary>
  );
}

export default App;
