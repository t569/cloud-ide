// frontend/src/editor/components/IDETerminal.tsx
import React, { useState, useEffect, useRef } from 'react';
import { TerminalTabs, TerminalSession } from '../../terminal/components/TerminalTabs';
import { ITransportStream } from '../../terminal/types/terminal';
import { EditorEventBus } from '../core/EditorEventBus';


// DESIGN SYSTEM
import { useDesignSystem } from '../context/DesignSystemContext';
import { toXtermTheme } from '../utils/themeAdapters';


// ==========================================
// 1. THE TRANSPORT INTERFACE (Backend Bridge)
// ==========================================
// TODO: Replace this with your real WebSocketTransport when the backend is ready.
class MockLocalTransport implements ITransportStream {
  private dataListeners: ((data: string) => void)[] = [];
  
  constructor(private title: string) {}

  async connect(): Promise<void> {
    setTimeout(() => {
      this.broadcast(`\r\n\x1b[36m[System]\x1b[0m Connected to ${this.title}.`);
      this.broadcast('\r\n~/cloud-ide $ ');
    }, 100);
  }

  disconnect(): void { this.dataListeners = []; }
  onData(callback: (data: string) => void): void { this.dataListeners.push(callback); }
  onError(): void {}
  write(data: string): void {
    if (data === '\x7f') {
      this.broadcast('\b \b'); // Handle basic backspace for the mock
      return;
    }
    this.broadcast(data); // Local typing echo
    if (data === '\r') this.broadcast('\r\n~/cloud-ide $ '); // Fake enter prompt
  }
  private broadcast(data: string) { this.dataListeners.forEach(cb => cb(data)); }
}

// ==========================================
// 2. THE COMPONENT INTERFACE
// ==========================================
interface IDETerminalProps {
  sandboxId: string;
  editorEventBus: EditorEventBus; // We inject the Editor's nervous system here!
}

export const IDETerminal = ({ sandboxId, editorEventBus }: IDETerminalProps) => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const hasBooted = useRef(false);
  // 1. Grab the Global Palette from the Design System
  const { palette } = useDesignSystem();


  // 1. Boot up a new terminal tab
  const addTab = () => {
    setSessions(prev => {
      const newId = `term-${Date.now()}`;
      const newTitle = `bash-${prev.length + 1}`;
      
      // TODO: When backend is ready, do: new WebSocketTransport(`ws://.../${sandboxId}/pty`)
      const transport = new MockLocalTransport(newTitle);
      transport.connect();
      
      return [...prev, { id: newId, title: newTitle, transport }];
    });
  };

  // Ensure we boot exactly one terminal on load
  useEffect(() => {
    if (!hasBooted.current) {
      hasBooted.current = true;
      addTab();
    }
  }, []);

  // 2. Gracefully kill a terminal connection
  const closeTab = (idToClose: string) => {
    setSessions(prev => {
      const session = prev.find(s => s.id === idToClose);
      if (session) session.transport.disconnect(); // Prevent memory/socket leaks!
      return prev.filter(s => s.id !== idToClose);
    });
  };

  useEffect(() => {
    if(!hasBooted.current) {
      hasBooted.current = true;
      addTab();
    }
  }, []);

  // ==========================================
  // 3. THE CROSS-SYSTEM BRIDGE
  // ==========================================
  const handleContextFileClick = (fileName: string) => {
    // The Terminal's Context Sniffer found a file and the user clicked it.
    // We emit an event to the EDITOR's bus to open it in a Monaco tab!
    console.log(`[Terminal Bridge] Requesting Editor to open: ${fileName}`);
    
    // Ensure we format it as an absolute path for the VFS
    const path = fileName.startsWith('/') ? fileName : `/${fileName}`;
    editorEventBus.emit('FILE_OPEN_REQUESTED', { path });
  };

  const handleLinkClick = (url: string) => {
    // e.g., intercepting "http://localhost:3000" to open a proxy preview tab
    console.log(`[Terminal Bridge] Intercepted URL click: ${url}`);
  };

  return (
    <TerminalTabs 
      initialSessions={sessions}
      onAddTab={addTab}
      onCloseTab={closeTab}
      onFileClick={handleContextFileClick}
      onLinkClick={handleLinkClick}
      theme={toXtermTheme(palette)}
    />
  );
};