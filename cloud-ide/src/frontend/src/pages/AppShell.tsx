// App shell = the route table. Maps the current URL to a page. A refresh lands
// on the same view because the URL is the single source of truth (the Vite dev
// server serves index.html for any path; a static host needs SPA fallback).
//
// Routes:
//   /environments (and / )      → Environments (env-manager)
//   /sandboxes                  → Sandboxes (resume live/paused workspaces)
//   /health                     → Health (subsystem status board)
//   /editor/:sandboxId          → IDE workspace, booted for that sandbox
import React from 'react';
import { useLocation } from './router';
import { getSession } from './sessionStore';
import Environments from './Environments';
import Sandboxes from './Sandboxes';
import Workspaces from './Workspaces';
import Health from './Health';
import IDEWorkspace from './IDEWorkspace';

const EDITOR_ROUTE = /^\/editor\/([^/]+)\/?$/;

export default function AppShell() {
  const location = useLocation();
  const path = location.split('?')[0];

  const editorMatch = path.match(EDITOR_ROUTE);
  if (editorMatch) {
    const sandboxId = decodeURIComponent(editorMatch[1]);
    // Warm boot (env-manager → editor) stashed the full session (name + envConfig);
    // a cold deep-link falls back to { sandboxId }.
    // ponytail: ?snapshot=<id> is consumed here once Step 11 (snapshot restore) lands.
    return <IDEWorkspace session={getSession(sandboxId)} />;
  }

  if (path === '/sandboxes') return <Sandboxes />;
  if (path === '/workspaces') return <Workspaces />;
  if (path === '/health') return <Health />;

  // Default: the environment manager.
  return <Environments />;
}
