// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
// import App from './App';
import './index.css'; 
import { EnvManager } from './env-manager';
import { LocalTerminalTest } from './terminal/dev/TerminalApp';
import { BuildLogViewer } from './terminal/dev/BuildLogViewer';
import { IdeWorkspace } from './terminal/dev/IdeWorkspace';
import { IdeWorkspaceTest } from './terminal/dev/IdeWorkspaceTest';
import App from './IconTest';
// It is looking for 'root' here
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App/>
  </React.StrictMode>
);