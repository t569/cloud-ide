// frontend/src/UITestHarness.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { DesignSystemProvider, useDesignSystem } from '@frontend/editor/context/DesignSystemContext';
import { IDETerminal } from '@frontend/editor/components/IDETerminal';
import { EditorEventBus } from '@frontend/editor/core/EditorEventBus';

// --- INNER DASHBOARD (Has access to the Theme Context) ---
const Dashboard = () => {
  const { settings, updateSettings } = useDesignSystem();
  const [logs, setLogs] = useState<string[]>([]);

  // 1. Instantiate the mock Editor Event Bus
  const mockEditorBus = useMemo(() => new EditorEventBus(), []);

  // 2. Listen for Terminal-to-Editor Bridge events
  useEffect(() => {
    const unsub = mockEditorBus.on('FILE_OPEN_REQUESTED', (payload) => {
      setLogs(prev => [`[EditorBus Caught] File Clicked: ${payload.path}`, ...prev].slice(0, 10));
    });
    return () => unsub();
  }, [mockEditorBus]);

  // 3. Theme Toggler
  const toggleTheme = () => {
    updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
  };

  return (
    // Notice we are using Tailwind classes powered by our CSS variables!
    <div className="min-h-screen w-full bg-ide-bg text-ide-text font-ide flex flex-col p-8 transition-colors duration-200">
      
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ide-accent">UI & Terminal Test Harness</h1>
          <p className="text-sm text-ide-muted">Testing Tailwind v4, Contexts, and Event Bridges</p>
        </div>
        
        {/* THEME TOGGLE BUTTON */}
        <button 
          onClick={toggleTheme}
          className="px-4 py-2 bg-ide-panel border border-ide-border rounded hover:bg-ide-hover transition-colors"
        >
          Switch to {settings.theme === 'dark' ? 'Light' : 'Dark'} Mode
        </button>
      </div>

      <div className="flex gap-6 h-[500px]">
        {/* LEFT: The Terminal Integration */}
        <div className="flex-1 flex flex-col border border-ide-border rounded overflow-hidden shadow-lg">
          <div className="bg-ide-panel px-4 py-2 text-xs text-ide-muted border-b border-ide-border">
            Zone 5: IDETerminal.tsx
          </div>
          <div className="flex-1 relative bg-ide-bg">
             <IDETerminal 
               sandboxId="test-sandbox-123" 
               editorEventBus={mockEditorBus} 
             />
          </div>
        </div>

        {/* RIGHT: Event Logs & Instructions */}
        <div className="w-1/3 flex flex-col gap-4">
          <div className="p-4 bg-ide-panel border border-ide-border rounded">
            <h2 className="text-ide-accent font-bold mb-2">Testing Instructions:</h2>
            <ul className="list-disc list-inside text-sm space-y-2 text-ide-muted">
              <li>Click the Theme Toggle button above. The React UI and Terminal should swap instantly.</li>
              <li>Click the <code>+</code> button on the terminal tab bar to spawn a second PTY.</li>
              <li>Click the <code>x</code> to close a tab.</li>
              <li>Type <code>/src/app.ts</code> in the terminal and press Enter.</li>
              <li>Hold <strong>Ctrl</strong> (or Cmd on Mac) and click the path you just typed. It should appear in the logs below!</li>
            </ul>
          </div>

          <div className="flex-1 p-4 bg-black/50 border border-ide-border rounded overflow-y-auto">
             <h3 className="text-xs text-gray-500 mb-2">// EditorEventBus Logs</h3>
             {logs.length === 0 && <span className="text-gray-600 text-sm">Waiting for terminal events...</span>}
             {logs.map((log, i) => (
               <div key={i} className="text-green-400 text-sm font-mono">{log}</div>
             ))}
          </div>
        </div>
      </div>

    </div>
  );
};

// --- OUTER WRAPPER ---
export const UITestHarness = () => {
  return (
    <DesignSystemProvider>
      <Dashboard />
    </DesignSystemProvider>
  );
};