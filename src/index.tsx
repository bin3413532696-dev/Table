import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import { AgentProvider } from './agent/AgentContext';
import { initDB } from './db';
import { initializeData, startAutoSync, startRealtimeSync } from './lib/dataSync';
import './styles/index.css';

initDB();

// 初始化数据并启动同步
initializeData().then(() => {
  startAutoSync();
  startRealtimeSync();
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <AgentProvider>
          <App />
        </AgentProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
