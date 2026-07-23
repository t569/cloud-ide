// App shell = the route table. Maps the current URL to a page. A refresh lands
// on the same view because the URL is the single source of truth (the Vite dev
// server serves index.html for any path; a static host needs SPA fallback).
//
// Routes:
//   /environments (and / )      → Environments (env-manager)
//   /sandboxes                  → Sandboxes (resume live/paused workspaces)
//   /health                     → Health (subsystem status board)
//   /editor/:sandboxId          → IDE workspace, booted for that sandbox
//   /local/:workspaceId         → IDE workspace running ENTIRELY IN THE BROWSER
import React from 'react';
import { useLocation } from './router';
import { getSession } from './sessionStore';
import { GIT_CORS_PROXY } from '../config/env';
import Environments from './Environments';
import Sandboxes from './Sandboxes';
import Workspaces from './Workspaces';
import Health from './Health';
import IDEWorkspace from './IDEWorkspace';

const EDITOR_ROUTE = /^\/editor\/([^/]+)\/?$/;
const LOCAL_ROUTE = /^\/local\/([^/]+)\/?$/;

export default function AppShell() {
  const location = useLocation();
  const path = location.split('?')[0];

  // The browser tier is a ROUTE, not a stashed session. sessionStore is in-memory, so a
  // reload or a shared link would lose `tier` and silently fall back to the server path —
  // fatal for the one tier whose whole point is working without a server. Putting it in the
  // URL means a refresh (or being offline) still lands you in the right place.
  const localMatch = path.match(LOCAL_ROUTE);
  if (localMatch) {
    const workspaceId = decodeURIComponent(localMatch[1]);
    return (
      <IDEWorkspace
        session={{
          // The editor keys layout and open-tab persistence off sandboxId; there is no
          // sandbox here, so the workspace id plays that role.
          sandboxId: workspaceId,
          workspaceId,
          tier: 'browser',
          workspaceName: getSession(workspaceId).workspaceName ?? workspaceId,
          corsProxy: GIT_CORS_PROXY,
        }}
      />
    );
  }

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
