import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import Dashboard from './pages/Dashboard';
import Notes from './pages/Notes';
import Tasks from './pages/Tasks';
import Tools from './pages/Tools';
import Finance from './pages/Finance';
import Settings from './pages/Settings';

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="notes" element={<Notes />} />
          <Route path="tasks" element={<Tasks />} />
          <Route path="tools" element={<Tools />} />
          <Route path="finance" element={<Finance />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
