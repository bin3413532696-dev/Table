import React from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { AgentProvider } from '../features/agent/public';
import { ThemeProvider } from '../contexts/ThemeContext';
import { UserProvider } from '../contexts/UserContext';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <UserProvider>
          <AgentProvider>{children}</AgentProvider>
        </UserProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
