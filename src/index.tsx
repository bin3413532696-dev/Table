import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeAppData } from './app/bootstrap';
import { AppProviders } from './app/providers';
import './styles/index.css';

void initializeAppData();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
);
