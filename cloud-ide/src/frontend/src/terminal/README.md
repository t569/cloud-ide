# ☁️ Cloud IDE: Terminal Architecture & Implementation Guide

## Overview
This module provides a highly decoupled, **GPU-accelerated**, and multiplexed terminal interface powered by `xterm.js`. It is built using the **Ports and Adapters (Hexagonal)** architectural pattern, strictly separating UI rendering from backend execution environments (WebSocket PTYs, Docker logs).

This design solves common browser-based IDE challenges: **WebGL context loss**, **flexbox boundary collapses**, **canvas-based focus stealing**, and **UI thread blocking**.

## Directory Structure
```plaintext
terminal/
├── components/           # The "Dumb" UI Presentation Layer
│   ├── Terminal.tsx
│   ├── TerminalContextMenu.tsx
│   ├── TerminalContextWidget.tsx
│   ├── TerminalPanel.tsx
│   ├── TerminalSearchWidget.tsx
│   ├── TerminalTabs.tsx
│   └── theme.ts
├── core/                 # The Event Kernel & Data Processing
│   ├── middlewares/      # Intercepts/mutates raw string streams
│   │   ├── CommandSnifferMiddleware.ts
│   │   └── WindowsClearFix.ts
│   ├── plugins/          # Background tasks acting on terminal events
│   │   ├── FileIconPlugin.ts
│   │   ├── LinkSnifferPluggin.ts
│   │   └── RepoGraphPlugin.ts
│   ├── InputManager.ts   # PTY key translation & Clipboard handling
│   ├── MiddlewarePipeline.ts
│   └── TerminalEventBus.ts # The isolated Pub/Sub nervous system
├── dev/
│   └── IdeWorkspaceTest.tsx
├── hooks/
│   └── useTerminal.ts    # Core xterm.js instance & WebGL wrapper
├── providers/
│   └── IdeLinkProvider.ts# Parses raw text into clickable elements
├── transport/            # The Infrastructure Layer (Network APIs)
│   ├── DockerStream.ts
│   ├── SessionStream.ts
│   └── WebSocketTransport.ts
├── types/
│   ├── terminal.d.ts
│   └── index.ts
└── README.md
```
---

### 1. The Presentation Layer (`/components`)

*   **`useTerminal.ts`**: The low-level wrapper around the `xterm.js` class. Manages the **WebGL context**, instantiates addons (**Fit, Search, WebLinks**), and uses a `ResizeObserver` to mathematically enforce perfect canvas dimensions.
*   **`Terminal.tsx`**: The React boundary. Exposes safe imperative methods (`write`, `clear`, `getSelection`) via `TerminalHandle`. Sets up the `MiddlewarePipeline` and local DOM event listeners (like intercepting custom pastes).
*   **`TerminalPanel.tsx`**: The **Isolation Sandbox**. Bundles a single terminal canvas with a private `TerminalEventBus`. Stacks in the DOM using `position: absolute` and `visibility: hidden` to prevent background WebGL canvases from collapsing when inactive.
*   **`TerminalTabs.tsx`**: The **Session Multiplexer**. Renders the tab bar and simultaneously mounts all active `TerminalPanel` components, controlling their visibility state.
*   **`TerminalContextMenu.tsx`**: The **Canvas Clipboard Manager**. Uses a "Snapshot Strategy" to capture highlighted text before the menu opens, and "Focus Protection" (`e.preventDefault()`) to prevent `xterm.js` from erasing the selection.
*   **`TerminalContextWidget.tsx` & `TerminalSearchWidget.tsx`**: Decoupled, floating HUDs that react exclusively to `TerminalEventBus` signals.

---

### 2. The Infrastructure Layer (`/transport`)

The UI components never speak directly to a WebSocket or an API. They only communicate via the `ITransportStream` interface.

*   **`WebSocketTransport.ts`**: The production workhorse. Connects to the `execd` PTY daemon inside the isolated container. Handles **binary ArrayBuffer conversion**, exponential backoff reconnection, and sending JSON control payloads (like window resizing commands).
*   **`DockerStream.ts` / `SessionStream.ts`**: Alternate transport implementations. For example, `DockerStream` might be a read-only transport used purely for tailing build logs from the environment manager.

### 3. The Protocol Layer (`/core/middlewares`)
Sits directly between the **Transport** and the **Screen**. It sanitizes data moving in both directions.

* **`MiddlewarePipeline.ts`**: The orchestrator. Loops through registered middlewares applying `processIncoming` (Backend -> Screen) and `processOutgoing` (Keyboard -> Backend).
* **`WindowsClearFix.ts`**: A standard pipeline sanitizer that intercepts broken `\r\n` carriage returns or specific clear-screen ANSI codes from different OS backends and normalizes them for the browser canvas.
* **`CommandSnifferMiddleware.ts`**: Intercepts outgoing keystrokes. When it detects an **Enter** key (`\r`), it broadcasts the assembled command string over the **Event Bus** for plugins to consume.

### 4. The Event Kernel & Plugins (`/core/plugins`)
The core architectural principle of this terminal is **Zero UI Blocking**. Feature logic runs in decoupled plugins.

* **`TerminalEventBus.ts`**: A strictly typed Pub/Sub system. Every terminal tab gets its own isolated bus.
* **`FileIconPlugin.ts` & `LinkSnifferPluggin.ts`**: Listen to data streams, apply regex patterns to detect paths or URLs, and emit `UI_CONTEXT_SUGGESTED` events to populate the Context HUD.
* **`RepoGraphPlugin.ts`**: An agentic tracking plugin. Listens to executed commands via the `CommandSnifferMiddleware` to dynamically update a localized knowledge graph of the user's repository state, providing contextual memory for AI assistants.

### 5. Input & Link Management
* **`InputManager.ts`**: Translates browser DOM events into Linux PTY standards. For example, translating a "Copy" command, translating `SIGINT` (Ctrl+C) into `\x03`, and managing asynchronous `navigator.clipboard` requests safely.
* **`IdeLinkProvider.ts`**: Hooks into the core `xterm.js` rendering engine. It highlights recognizable text patterns (like `http://localhost:5173`) and fires events to the bus when the user physically clicks the canvas.

## Implementation Guide: Building Workspace.tsx

When migrating from the Dev Harness to the production IDE Workspace, use this boilerplate to dynamically instantiate real `WebSocketTransport` connections and handle Cloud IDE URL proxying.

### Architectural Note: URL Proxying
When a user runs a dev server (like Vite or React) inside their container, the terminal outputs `http://localhost:5173`. However, localhost inside a Docker container is not accessible to the user's browser. The Workspace component intercepts these clicks, extracts the port, and rewrites the URL to route through the Cloud IDE's proxy domain (e.g., `https://5173-[sandbox-id].your-cloud-ide.com`).

```typescript
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TerminalTabs, TerminalSession } from '@frontend/terminal/components/TerminalTabs';
import { WebSocketTransport } from '@frontend/terminal/transport/WebSocketTransport';
import { TerminalEventBus } from '@frontend/terminal/core/TerminalEventBus';
import { FileIconPlugin } from '@frontend/terminal/core/plugins/FileIconPlugin';
import { LinkSnifferPlugin } from '@frontend/terminal/core/plugins/LinkSnifferPlugin';

interface IdeWorkspaceProps {
  sandboxId: string; // The unique ID of the container environment
}

export const ProductionWorkspace = ({ sandboxId }: IdeWorkspaceProps) => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);

  /**
   * Provisions a new PTY daemon via the backend and connects the Transport.
   */
  const startNewTerminalSession = async () => {
    try {
      // 1. Request a new PTY session from the container orchestrator
      const response = await fetch('/api/v1/sandbox/terminal/spawn', { method: 'POST' });
      const { port, sessionId } = await response.json();

      // 2. Initialize the production WebSocket transport
      const wsUrl = `wss://://yourdomain.com{sessionId}?port=${port}`;
      const transport = new WebSocketTransport(wsUrl);

      // 3. Register the session in state
      const newSession: TerminalSession = {
        id: sessionId,
        title: `bash-${sessions.length + 1}`,
        transport: transport
      };

      setSessions(prev => [...prev, newSession]);

      // 4. Connect the socket
      await transport.connect();

    } catch (error) {
      console.error("Failed to spawn terminal process", error);
    }
  };

  /**
   * Safely kills the backend process and removes the UI tab.
   */
  const handleCloseTab = (idToClose: string) => {
    setSessions(prev => {
      const session = prev.find(s => s.id === idToClose);
      if (session) {
        // Disconnecting the WebSocket sends a SIGTERM to the backend PTY
        session.transport.disconnect(); 
      }
      return prev.filter(s => s.id !== idToClose);
    });
  };

  /**
   * Action handlers for the floating Context HUD.
   */
  const handleFileClick = (fileName: string) => {
    // Dispatch to global IDE state (e.g., Redux or Zustand) to open the Editor tab
    // dispatch(openFileTab(fileName));
    console.log(`[IDE Action] User clicked ${fileName}. Opening in code editor.`);
  };

  /**
   * Intercepts "localhost" links and proxies them through the Cloud IDE router.
   */
  const handleLinkClick = (rawUrl: string) => {
    // 1. Extract the port from the raw URL (e.g., "http://localhost:5173" -> "5173")
    const portMatch = rawUrl.match(/:(\d{2,5})/);
    if (!portMatch) return;
    const port = portMatch[1];

    // 2. Build the proxy URL based on the backend OpenSandbox architecture
    const proxiedUrl = `https://${port}-${sandboxId}.your-cloud-ide.com`;

    console.log(`[IDE Action] Intercepted ${rawUrl}. Opening split pane for ${proxiedUrl}`);
    
    // 3. Dispatch action to open the built-in browser/preview tab in the IDE
    // dispatch(openPreviewTab(proxiedUrl));
  };

  return (
    <div className="w-full h-full bg-[#1e1e1e] flex flex-col">
      {/* The TerminalTabs component handles all internal multiplexing, 
        WebGL canvas retention, and Plugin instantiation natively.
      */}
      <TerminalTabs 
        initialSessions={sessions}
        onAddTab={startNewTerminalSession}
        onCloseTab={handleCloseTab}
        onFileClick={handleFileClick}
        onLinkClick={handleLinkClick}
      />
    </div>
  );
};
```
## Implementation Guide: Extending the terminal with middlewares and plugins

## Extensibility: Middlewares & Plugins

The terminal is designed to be infinitely extensible without ever touching the core `Terminal.tsx` React component. You can add features in two ways: **Middlewares** (synchronous data mutation) and **Plugins** (asynchronous event listeners).

### 1. How to Write a Middleware
**Use Case:** You need to intercept, modify, or block raw text flowing between the backend and the terminal screen. Examples: Syntax highlighting, stripping bad ANSI codes, or vim-mode keystroke interception.

#### Step 1: Create the Middleware Class
Create a new file in `frontend/src/terminal/core/middlewares/`. Your class must implement the `ITerminalMiddleware` interface.

```typescript
// frontend/src/terminal/core/middlewares/SecretRedactorMiddleware.ts
import { ITerminalMiddleware } from '../../types/terminal';

export class SecretRedactorMiddleware implements ITerminalMiddleware {
  name = 'SecretRedactorMiddleware';

  /**
   * Data coming FROM the backend, headed to the SCREEN.
   */
  processIncoming(data: string): string {
    // Example: Mask API keys before they render on the user's screen
    if (data.includes('sk-live-')) {
      return data.replace(/sk-live-[a-zA-Z0-9]+/, 'sk-live-********');
    }
    return data;
  }

  /**
   * Data coming FROM the keyboard, headed to the BACKEND.
   */
  processOutgoing(data: string): string {
    // Example: Prevent the user from typing 'rm -rf /'
    if (data === 'rm -rf /\r') {
      console.warn('Blocked destructive command.');
      return '\r\necho "Command blocked by IDE policy"\r\n';
    }
    return data;
  }
}
```
#### Step 2: Register the Middleware
Open `frontend/src/terminal/core/TerminalRegistry.ts` and add your new class to the `getDefaultMiddlewares` array. The pipeline will automatically pick it up for all new terminal sessions.

```typescript
// Inside TerminalRegistry.ts
import { SecretRedactorMiddleware } from './middlewares/SecretRedactorMiddleware';

static getDefaultMiddlewares(eventBus: TerminalEventBus): ITerminalMiddleware[] {
  return [
    new WindowsClearFix(),
    new CommandSnifferMiddleware(eventBus),
    new SecretRedactorMiddleware() // <--- Activated!
  ];
}
```
### 2. How to Write a Plugin
**Use Case:** You need to perform background tasks, trigger UI updates, or track state without blocking the terminal's typing speed. Plugins do not mutate text; they listen to the `TerminalEventBus`. Examples: Knowledge graph building, triggering confetti on a successful build, or custom contextual suggestions.

#### Step 1: Create the Plugin Class
Create a new file in `frontend/src/terminal/core/plugins/`. It must implement `ITerminalPlugin` and its `initialize` method.

```typescript
// frontend/src/terminal/core/plugins/BuildSuccessPlugin.ts
import { ITerminalPlugin, TerminalEventBus } from '../TerminalEventBus';

export class BuildSuccessPlugin implements ITerminalPlugin {
  name = 'BuildSuccessPlugin';

  initialize(eventBus: TerminalEventBus): void {
    // 1. Listen for full commands sniffed by the CommandSnifferMiddleware
    eventBus.on('COMMAND_EXECUTED', (payload) => {
      const { command } = payload;
      
      // 2. React to specific commands
      if (command.startsWith('npm run build')) {
        console.log('[BuildSuccessPlugin] Build started! Tracking progress...');
        
        // Example: Emit a custom event to the Context HUD to show a "Build Active" badge
        eventBus.emit('UI_CONTEXT_SUGGESTED', {
          type: 'links',
          items: ['Build Viewer']
        });
      }
    });

    // You can also listen to general UI events
    eventBus.on('UI_TOGGLE_SEARCH', (payload) => {
      // e.g., Pause background polling while the user is searching
    });
  }
}
```
#### Step 2: Define New Event Payloads (Optional)
If your plugin needs to broadcast a brand new type of event, add it to the strict type definitions in `TerminalEventBus.ts` so the rest of the app gets TypeScript autocomplete.

```typescript
// Inside TerminalEventBus.ts
export interface TerminalEventPayloads {
  // ... existing events
  'CUSTOM_PLUGIN_EVENT': { data: string; timestamp: number };
}
```
#### Step 3: Register the Plugin
Just like middlewares, open `frontend/src/terminal/core/TerminalRegistry.ts` and add your plugin to the factory method.

```typescript
// Inside TerminalRegistry.ts
import { BuildSuccessPlugin } from './plugins/BuildSuccessPlugin';

static getDefaultPlugins(): ITerminalPlugin[] {
  return [
    new FileIconPlugin(),
    new LinkSnifferPlugin(),
    new BuildSuccessPlugin() // <--- Activated!
  ];
}
```

### The Golden Rule of Extension

*   **Use a Middleware** if it needs to change what the user **sees** or change what the server **receives**.
*   **Use a Plugin** if it needs to **react** to what happens or update external React UI.


## Renders

### For observation purposes, our current terminal looks like this:

![Terminal Tabs default](./imgs/terminal_look.png)

### We also have an example of a readonly terminal to stream build logs e.g.

```typescript
// frontend/src/BuildLogViewer.tsx
import React, { useEffect, useRef } from 'react'; // Removed useMemo

import { TerminalComponent, TerminalHandle } from '@frontend/terminal/components/Terminal';

// Or whatever transport layer you decide to build
import { MockBuildTransport } from '@frontend/terminal/dev/MockBuildTransport';

export const BuildLogViewer = () => {
  const terminalRef = useRef<TerminalHandle>(null);
  
  // FIXED 2: Bind the class instance to a ref so React can never garbage-collect 
  // it while the component is mounted. We extract .current immediately for clean usage.
  const buildTransport = useRef(new MockBuildTransport()).current;

  useEffect(() => {
    // This is safe even in React 18 Strict Mode double-mounts, 
    // as long as your MockBuildTransport handles rapid disconnect/reconnects.
    buildTransport.connect();
    
    return () => buildTransport.disconnect();
  }, [buildTransport]);

  const handleStartBuild = () => {
    // Clear the screen before starting a new build
    terminalRef.current?.clear(); 
    buildTransport.startMockBuild();
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#111', color: 'white', height: '100vh' }}>
      <h2>Environment Build Logs</h2>
      
      <button 
        onClick={handleStartBuild}
        style={{ marginBottom: '10px', padding: '8px 16px', background: '#0dbc79', border: 'none', cursor: 'pointer' }}
      >
        Trigger Mock Build
      </button>

      {/* The dimensions here act as a hard boundary, which the xterm ResizeObserver 
          will detect and perfectly fit the terminal inside! */}
      <div style={{ height: '400px', width: '800px', border: '1px solid #333' }}>
        <TerminalComponent 
          ref={terminalRef}
          theme="dark"
          isReadOnly={true}              // Locks the keyboard
          transport={buildTransport}     // Streams the logs
        />
      </div>
    </div>
  );
};
```

to give us this:
![Build Log Terminal](./imgs/build_log_terminal.png)

# 🗺️ Project Roadmap & TODO

### ✅ Phase 1: Core Engine & Rendering (Completed)
- [x] Integrate **xterm.js** with React via custom `useTerminal` hook.
- [x] Enable **WebglAddon** for hardware-accelerated GPU rendering.
- [x] Implement **ResizeObserver** for bulletproof, dimension-aware canvas fitting.
- [x] Establish the **TerminalHandle** imperative API boundary.

### ✅ Phase 2: UI & Multiplexing (Completed)
- [x] Build **TerminalTabs** session manager (VS Code style).
- [x] Implement the **"Canvas Retention Hack"** (`visibility: hidden` + `position: absolute`) to keep background terminals alive.
- [x] Build floating **Context Menu** with Focus Protection and Snapshot Copying.
- [x] Build floating **Search Widget** with auto-focus and keybindings.
- [x] Build dismissible **Context HUD** for surfacing actionable terminal data.

### ✅ Phase 3: Architecture & Extensibility (Completed)
- [x] Establish the **Hexagonal Architecture** (Ports and Adapters).
- [x] Implement **TerminalEventBus** for isolated Pub/Sub communication per tab.
- [x] Build **MiddlewarePipeline** for intercepting / sanitizing I/O streams.
- [x] Build **TerminalRegistry** factory to manage plugin/middleware instantiation.
- [x] Implement **UI Plugins** (`FileIconPlugin`, `LinkSnifferPlugin`).
- [x] Implement **URL Proxy routing** for Cloud IDE localhost intercepts.

### ⏳ Phase 4: Backend Integration (Next Up)
- [ ] Build **`WebSocketTransport.ts`** (Frontend): Implement the production transport layer with binary `ArrayBuffer` support, exponential backoff, and auto-reconnection.
- [ ] Build **`execd` Daemon** (Backend): Create the Node.js WebSocket server inside the container.
- [ ] Integrate **`node-pty`** (Backend): Spawn real Linux bash shells and pipe the streams to the WebSocket.
- [ ] **Handle Resize Events**: Send JSON control messages from the frontend `ResizeObserver` to update the backend `node-pty` column/row limits.

### ⏳ Phase 5: State & Ecosystem (Planned)
- [ ] **Session Persistence**: Use `SerializeAddon` to save the active terminal buffer to `localStorage` or the backend, restoring it seamlessly on browser refreshes.
- [ ] **Complete `RepoGraphPlugin`**: Finalize the agentic tracking system to map executed commands into a version-controlled knowledge graph for the IDE's AI assistant.
- [ ] **Global IDE Wiring**: Connect the Context HUD `onFileClick` events to the global state manager (e.g., Redux/Zustand) to automatically open files in the main code editor.


