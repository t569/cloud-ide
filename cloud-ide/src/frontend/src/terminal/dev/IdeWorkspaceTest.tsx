// frontend/src/terminal/dev/IdeWorkspaceTest.tsx
import React, { useState, useEffect, useRef } from 'react';
import { TerminalTabs, TerminalSession } from '../components/TerminalTabs'; // NEW IMPORT
import { ITransportStream } from '../types/terminal';

// ==========================================
// 1. THE MOCK TRANSPORT (Same as before)
// ==========================================
class MockTriggerTransport implements ITransportStream {
  private dataListeners: ((data: string) => void)[] = [];
  
  constructor(private name: string) {} // Added name so tabs look different!

  async connect(): Promise<void> {
    setTimeout(() => {
      this.broadcast(`\r\n\x1b[36m[System]\x1b[0m Welcome to ${this.name}.`);
      this.broadcast('\r\n~/cloud-ide $ ');
    }, 100);
  }

  disconnect(): void { this.dataListeners = []; }
  onData(callback: (data: string) => void): void { this.dataListeners.push(callback); }
  onError(): void {}
  private broadcast(data: string) { this.dataListeners.forEach(cb => cb(data)); }

  // this is a hack for backspace ONLY for testing
  // we wont use this in production
  write(data: string): void {
    // ==========================================
    // THE FIX: Handle Backspace (\x7f)
    // ==========================================
    if (data === '\x7f') {
      this.broadcast('\b \b'); // Move left, erase with space, move left again
      return;
    }

    // Local echo so we see regular typing
    this.broadcast(data);

    // When the user hits Enter (\r), trigger the mock logs!
    if (data === '\r') {
      this.broadcast('\r\n\x1b[36m> Executing mock build...\x1b[0m');
      
      setTimeout(() => this.broadcast('\r\nCompiling \x1b[32msrc/App.tsx\x1b[0m...'), 200);
      setTimeout(() => this.broadcast('\r\nUpdating \x1b[32mdockerfile\x1b[0m...'), 400);
      setTimeout(() => this.broadcast('\r\nWARN: Missing dependencies in \x1b[33mpackage.json\x1b[0m!'), 600);
      setTimeout(() => this.broadcast('\r\nERR: Failed to parse \x1b[31mtailwind.config.js\x1b[0m.'), 800);
      
      setTimeout(() => this.broadcast('\r\n\x1b[32m➜\x1b[0m  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m'), 1100);

      setTimeout(() => this.broadcast(`\r\n~/cloud-ide $ `), 1300);
    }
  }
}

// ==========================================
// 2. THE TEST HARNESS COMPONENT
// ==========================================
export const IdeWorkspaceTest = () => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  
  // NEW: A flag to protect against React 18 Strict Mode double-mounting
  const hasBooted = useRef(false); 

  const addTab = () => {
    // Note: We use the length of the PREVIOUS state to ensure numbers are always accurate
    setSessions(prev => {
      const newId = `term-${Date.now()}`;
      const newTitle = `bash-${prev.length + 1}`;
      const transport = new MockTriggerTransport(newTitle);
      
      transport.connect();
      return [...prev, { id: newId, title: newTitle, transport }];
    });
  };

  useEffect(() => {
    // ONLY run this once, even if React forces a double-mount!
    if (!hasBooted.current) {
      hasBooted.current = true;
      addTab();
    }
  }, []);

  const closeTab = (idToClose: string) => {
    setSessions(prev => {
      const sessionToClose = prev.find(s => s.id === idToClose);
      if (sessionToClose) sessionToClose.transport.disconnect(); // Kill the backend connection!
      return prev.filter(s => s.id !== idToClose);
    });
  };

  const handleFileClick = (fileName: string) => alert(`Opening: ${fileName}`);
  const handleLinkClick = (url: string) => alert(`Proxying: ${url}`);

  return (
    <div style={{ padding: '40px', backgroundColor: '#000', height: '100vh', display: 'flex', justifyItems: 'center', alignItems: 'center' }}>
      
      <div style={{ width: '900px', height: '600px', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
        
        {/* We replaced the single terminal with our new Multiplexer! */}
        <TerminalTabs 
          initialSessions={sessions}
          onAddTab={addTab}
          onCloseTab={closeTab}
          onFileClick={handleFileClick}
          onLinkClick={handleLinkClick}
        />

      </div>
    </div>
  );
};