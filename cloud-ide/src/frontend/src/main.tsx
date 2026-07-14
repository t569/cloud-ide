// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './common/iconifyOffline'; // register bundled file icons; disables all Iconify network fetches
import AppShell from './pages/AppShell';
import { Toaster, Dialogs } from './notifications';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
    <Toaster />
    <Dialogs />
  </React.StrictMode>,
);
