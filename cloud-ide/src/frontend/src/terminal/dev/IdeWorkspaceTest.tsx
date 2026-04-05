// frontend/src/terminal/dev/IdeWorkspaceTest.tsx
import React, { useMemo, useEffect, useRef } from 'react';
import { TerminalComponent, TerminalHandle } from '../components/Terminal';
import { TerminalContextWidget } from '../components/TerminalContextWidget';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { FileIconPlugin } from '../core/plugins/FileIconPlugin';
import { LinkSnifferPlugin } from '../core/plugins/LinkSnifferPluggin';
import { ITransportStream } from '../types/terminal';

// ==========================================
// 1. THE MOCK TRANSPORT (Simulates Backend Logs)
// ==========================================
class MockTriggerTransport implements ITransportStream {
  private dataListeners: ((data: string) => void)[] = [];

  async connect(): Promise<void> {
    setTimeout(() => {
      this.broadcast('\r\n\x1b[36m[System]\x1b[0m Welcome to the Context Widget Test Harness.');
      this.broadcast('\r\n\x1b[33mHint: Type anything and press ENTER to simulate a build process.\x1b[0m');
      this.broadcast('\r\n~/cloud-ide $ ');
    }, 100);
  }

  disconnect(): void {
    this.dataListeners = [];
  }

  onData(callback: (data: string) => void): void {
    this.dataListeners.push(callback);
  }

  onError(): void {}

  private broadcast(data: string) {
    this.dataListeners.forEach(cb => cb(data));
  }

  write(data: string): void {
    // Local echo so we see what we type
    this.broadcast(data);

    // When the user hits Enter (\r), trigger the mock logs!
    if (data === '\r') {
      this.broadcast('\r\n\x1b[36m> Executing mock build...\x1b[0m');
      
      // Simulate standard output with files scattered throughout
      setTimeout(() => this.broadcast('\r\nCompiling \x1b[32msrc/App.tsx\x1b[0m...'), 200);
      setTimeout(() => this.broadcast('\r\nUpdating \x1b[32mdockerfile\x1b[0m...'), 400);
      setTimeout(() => this.broadcast('\r\nWARN: Missing dependencies in \x1b[33mpackage.json\x1b[0m!'), 600);
      setTimeout(() => this.broadcast('\r\nERR: Failed to parse \x1b[31mtailwind.config.js\x1b[0m.'), 800);
      setTimeout(() => this.broadcast('\r\nGenerating \x1b[32mREADME.md\x1b[0m...'), 1000);
      setTimeout(() => this.broadcast('\r\nGenerating \x1b[32mkome.bat\x1b[0m...'), 1000);
      setTimeout(() => this.broadcast('\r\nGenerating \x1b[32m.gitignore\x1b[0m...'), 1000);
      
      // NEW: Simulate a dev server starting!
      setTimeout(() => this.broadcast('\r\n\x1b[32m➜\x1b[0m  Local:   \x1b[36mhttp://localhost:5173/\x1b[0m'), 1100);
      setTimeout(() => this.broadcast('\r\n\x1b[32m➜\x1b[0m  Network: \x1b[36mhttp://127.0.0.1:5173/\x1b[0m'), 1150);

      // Return the prompt
      setTimeout(() => this.broadcast('\r\n~/cloud-ide $ '), 1300);
    }
  }
}

// ==========================================
// 2. THE TEST HARNESS COMPONENT
// ==========================================
export const IdeWorkspaceTest = () => {
  const terminalRef = useRef<TerminalHandle>(null);

  // A. Create the shared Event Bus
  const sharedEventBus = useMemo(() => new TerminalEventBus(), []);

  // B. Initialize the Mock Transport
  const mockTransport = useMemo(() => new MockTriggerTransport(), []);

  // C. Initialize plugins (Added LinkSnifferPlugin!)
  const plugins = useMemo(() => [
    new FileIconPlugin(),
    new LinkSnifferPlugin()
  ], []);

  // Connect transport on mount
  useEffect(() => {
    mockTransport.connect();
    return () => mockTransport.disconnect();
  }, [mockTransport]);

  // Click handler for Files
  const handleContextClick = (fileName: string) => {
    alert(`[IDE Action Triggered]\n\nYou clicked: ${fileName}\n\nIn the real app, this would open the file tab!`);
  };

  // NEW: Click handler for Links
  const handleLinkClick = (url: string) => {
    alert(`[IDE Action Triggered]\n\nYou clicked: ${url}\n\nIn the real app, this would dynamically proxy the port and open the Preview Pane!`);
  };

  return (
    <div style={{ padding: '40px', backgroundColor: '#000', height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      
      <div style={{ width: '900px', display: 'flex', flexDirection: 'column', borderRadius: '8px', overflow: 'hidden', border: '1px solid #333', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
        
        {/* TOP: The Context Widget (Now handles files AND links) */}
        <TerminalContextWidget 
          eventBus={sharedEventBus} 
          onFileClick={handleContextClick} 
          onLinkClick={handleLinkClick} // Pass the new handler
        />

        {/* BOTTOM: The Terminal (Runs plugins and emits COMMAND_OUTPUT) */}
        <div style={{ height: '500px', backgroundColor: '#1e1e1e' }}>
          <TerminalComponent 
            ref={terminalRef}
            theme="dark" 
            transport={mockTransport} 
            plugins={plugins}
            eventBus={sharedEventBus} 
          />
        </div>

      </div>
    </div>
  );
};