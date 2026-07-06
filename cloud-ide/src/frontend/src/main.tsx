// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
// import App from './App';
import './index.css'; 
import { EnvManager } from './env-manager';
import { Toaster } from './notifications';
import { LocalTerminalTest } from './terminal/dev/TerminalApp';
import { BuildLogViewer } from './terminal/dev/BuildLogViewer';
import { IdeWorkspace } from './terminal/dev/IdeWorkspace';
import { IdeWorkspaceTest } from './terminal/dev/IdeWorkspaceTest';
import App from './IconTest';
import { EditorWorkspace } from './editor/components/EditorWorkspace';
import { VFSTestHarness } from './vfs/dev/VFSTestHarness';
import { UITestHarness } from './editor/dev/UITestHarness';
// It is looking for 'root' here
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  // TODO: EDITOR BUS IS CURRENTLY BROKEN, PLEASE FIX IT
  <React.StrictMode>
    <EnvManager/>
    <Toaster/>
  </React.StrictMode>
);