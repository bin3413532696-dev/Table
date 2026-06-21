import React, { useEffect, useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { PinLock } from '../components/PinLock';
import { fetchPinStatus } from '../shared/auth';
import { AppRouter } from './router';

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
        setPinCheckError(err instanceof Error ? err.message : '无法验证 PIN 状态，请检查网络连接');
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
      <AppRouter />
    </ErrorBoundary>
  );
}

export default App;
