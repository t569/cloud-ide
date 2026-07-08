// frontend/src/editor/components/IDETerminal.tsx
import { useState, useEffect, useRef } from 'react';
import { TerminalTabs, TerminalSession } from '../../terminal/components/TerminalTabs';
import { SseExecTransport } from '../../terminal/transport/SseExecTransport';
import { EditorEventBus } from '../core/EditorEventBus';


// DESIGN SYSTEM
import { useDesignSystem } from '../context/DesignSystemContext';
import { toXtermTheme } from '../utils/themeAdapters';


// ==========================================
// THE COMPONENT INTERFACE
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

      // Live backend: line-mode command streaming over SSE (POST /exec → execd).
      // ponytail: not a PTY — no vim/top, no persistent shell state between
      // commands. Upgrade path is a WS PTY bridge; see backend TERMINAL_BACKEND.md.
      const transport = new SseExecTransport(sandboxId);
      transport.connect();

      // sessionKey opts this tab into backend scrollback persistence + restore
      // (Gap B). Keyed per-tab so multiple terminals don't clobber each other.
      return [...prev, { id: newId, title: newTitle, transport, sessionKey: `${sandboxId}:${newId}` }];
    });
  };

  // Ensure we boot exactly one terminal on load.
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