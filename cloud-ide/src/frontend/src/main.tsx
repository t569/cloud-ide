// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import AppShell from './pages/AppShell';
import { Toaster } from './notifications';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
    <Toaster />
  </React.StrictMode>,
);
