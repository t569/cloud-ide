import React, { useState, useEffect, useMemo } from 'react';
import { EditorEventBus } from '@frontend/editor/core/EditorEventBus';
import { VFSController } from '@frontend/editor/core/VFSController';
import { FileNode, SyncStatus } from '../types/vfs';

export const VFSTestHarness = () => {
  // 1. Local state to observe what the VFS is doing
  const [tree, setTree] = useState<FileNode[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [logs, setLogs] = useState<string[]>([]);

  // 2. Instantiate the EventBus just like the real IDE does
  const eventBus = useMemo(() => new EditorEventBus(), []);

  // 3. Mock the Reducer Dispatch to catch VFS status updates
  const mockDispatch = (action: any) => {
    if (action.type === 'SET_SYNC_STATUS') {
      setSyncStatus(action.payload.status);
    }
    setLogs(prev => [`[Dispatch Caught] ${action.type}`, ...prev].slice(0, 10));
  };

  useEffect(() => {
    // 4. Boot the Controller!
    const controller = new VFSController(eventBus, mockDispatch as any, 'test-sandbox-123');

    // Listen for the Tree Generator output
    const unsubTree = eventBus.on('VFS_TREE_UPDATED', (payload) => {
      setTree(payload.tree);
      setLogs(prev => [`[Event Caught] VFS_TREE_UPDATED`, ...prev].slice(0, 10));
    });

    // Listen for File Loads (what Monaco would normally catch)
    const unsubLoaded = eventBus.on('FILE_LOADED', (payload) => {
      setLogs(prev => [`[Monaco Simulation] Loaded ${payload.path}: ${payload.content}`, ...prev].slice(0, 10));
    });

    // Boot the workspace (Hydration)
    controller.initWorkspace();

    return () => {
      unsubTree();
      unsubLoaded();
      controller.destroy();
    };
  }, [eventBus]);

  // ==========================================
  // BUTTON ACTIONS (Simulating User Input)
  // ==========================================

  const handleOpenFile = () => {
    eventBus.emit('FILE_OPEN_REQUESTED', { path: '/src/main.py' });
  };

  const handleEditFile = () => {
    // Simulates typing in Monaco
    eventBus.emit('CONTENT_CHANGED', { 
      path: '/src/main.py', 
      newContent: `print("Edited at ${new Date().toLocaleTimeString()}")` 
    });
  };

  const handleForceSave = () => {
    // Simulates Ctrl+S
    eventBus.emit('SAVE_REQUESTED', { path: '/src/main.py' });
  };

  // Note: These require you to add matching listeners in VFSController 
  // if you want to trigger them via EventBus, or you can expose VFS methods directly for testing.
  const handleCreateFile = () => {
    // For testing, we'll dispatch a custom event (Make sure to add this to your controller!)
    eventBus.emit('FILE_CREATED', { path: `/src/new_file_${Date.now()}.ts`, type: 'file' });
  };

  const handleDeleteFile = () => {
    eventBus.emit('FILE_DELETED', { path: '/README.md' });
  };

  return (
    <div className="p-8 bg-gray-900 text-white min-h-screen font-mono flex gap-8">
      {/* LEFT COLUMN: Controls & Status */}
      <div className="w-1/3 flex flex-col gap-4">
        <h1 className="text-xl font-bold text-blue-400">VFS Test Harness</h1>
        
        <div className="p-4 bg-gray-800 rounded border border-gray-700">
          <h2 className="text-sm text-gray-400 mb-2">Sync Status (Traffic Light)</h2>
          <div className={`text-lg font-bold uppercase tracking-wider
            ${syncStatus === 'synced' ? 'text-green-500' : ''}
            ${syncStatus === 'syncing' ? 'text-yellow-500' : ''}
            ${syncStatus === 'conflict' ? 'text-red-500' : ''}
          `}>
            ● {syncStatus}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button onClick={handleOpenFile} className="p-2 bg-blue-600 hover:bg-blue-500 rounded">1. Open /src/main.py</button>
          <button onClick={handleEditFile} className="p-2 bg-purple-600 hover:bg-purple-500 rounded">2. Type in Monaco (Edit)</button>
          <button onClick={handleForceSave} className="p-2 bg-green-600 hover:bg-green-500 rounded">3. Ctrl+S (Force Sync)</button>
          
          <div className="h-px bg-gray-700 my-2" />
          
          <button onClick={handleCreateFile} className="p-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">Create Random File</button>
          <button onClick={handleDeleteFile} className="p-2 bg-red-900 hover:bg-red-800 rounded text-sm">Delete README.md</button>
        </div>

        <div className="mt-4 p-4 bg-black rounded text-xs text-green-400 overflow-y-auto h-48 border border-gray-700">
          <h3 className="text-gray-500 mb-2">// Event Logs</h3>
          {logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>

      {/* RIGHT COLUMN: The File Explorer Tree */}
      <div className="flex-1 bg-gray-800 p-4 rounded border border-gray-700">
        <h2 className="text-sm text-gray-400 mb-4">Generated UI Tree (React State)</h2>
        <pre className="text-xs text-blue-300">
          {JSON.stringify(tree, null, 2)}
        </pre>
      </div>
    </div>
  );
};