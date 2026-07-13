// frontend/src/editor/components/IDETerminal.tsx
import { useState, useEffect, useRef } from 'react';
import { TerminalTabs, TerminalSession } from '../../terminal/components/TerminalTabs';
import { createTerminalTransport } from '../../terminal/transport/createTerminalTransport';
import { getSandboxCapabilities, getPreviewToken } from '../../api/sandbox';
import { EditorEventBus } from '../core/EditorEventBus';
import { API_BASE_URL } from '../../config/env';
import { toPreviewUrl } from '../../terminal/core/devUrl';
import { toast } from '../../notifications';


// DESIGN SYSTEM
import { useDesignSystem } from '../context/DesignSystemContext';
import { toXtermTheme } from '../utils/themeAdapters';


// ==========================================
// THE COMPONENT INTERFACE
// ==========================================
interface IDETerminalProps {
  sandboxId: string;
  editorEventBus: EditorEventBus; // We inject the Editor's nervous system here!
  /** Called with the proxied ingress URL when the user clicks a sniffed dev-server link. */
  onPreview: (url: string) => void;
}

export const IDETerminal = ({ sandboxId, editorEventBus, onPreview }: IDETerminalProps) => {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const hasBooted = useRef(false);
  // Driver PTY capability, resolved once before the first tab boots. Ref (not state)
  // so addTab reads the current value synchronously without re-rendering.
  const ptyCapable = useRef(false);
  // 1. Grab the Global Palette from the Design System
  const { palette } = useDesignSystem();


  // 1. Boot up a new terminal tab
  const addTab = () => {
    setSessions(prev => {
      const newId = `term-${Date.now()}`;
      const newTitle = `bash-${prev.length + 1}`;

      // Transport chosen by driver capability (see createTerminalTransport):
      // pty → interactive WS /pty bridge (real TTY: vim/top/colors); else line-mode
      // SSE. The 80×24 seed is re-synced by xterm's fit-addon resize on mount.
      const transport = createTerminalTransport(sandboxId, {
        pty: ptyCapable.current,
        initialSize: { cols: 80, rows: 24 },
        // Stable per-tab id: WebSocketTransport reconnects to this same URL, so the
        // backend re-binds to the running shell instead of spawning a fresh one.
        terminalId: newId,
      });
      transport.connect();

      // sessionKey opts this tab into backend scrollback persistence + restore
      // (Gap B). Keyed per-tab so multiple terminals don't clobber each other.
      return [...prev, { id: newId, title: newTitle, transport, sessionKey: `${sandboxId}:${newId}` }];
    });
  };

  // Ensure we boot exactly one terminal on load — after learning whether the driver
  // supports a PTY, so the first tab picks the right transport. A failed probe just
  // leaves pty=false (SSE), so the terminal always boots.
  useEffect(() => {
    if (hasBooted.current) return;
    hasBooted.current = true;
    getSandboxCapabilities()
      .then((caps) => { ptyCapable.current = !!caps.pty; })
      .catch(() => { /* keep SSE default */ })
      .finally(() => addTab());
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

  // A dev-server URL was activated — either the underlined link in the terminal output
  // (LINK_ACTIVATED) or its badge in the Context HUD. That localhost is INSIDE the
  // container, so the browser cannot reach it; opening it raw lands on the HOST's
  // localhost, which is this gateway, which answers "Cannot GET /". Rewrite it onto the
  // ingress, which proxies to whatever is listening on that port in the sandbox. This
  // is the "exposed port".
  const handleLinkClick = async (rawUrl: string) => {
    // API_BASE_URL ends in /api; the gateway (and its preview subdomains) is at the root.
    const gatewayOrigin = API_BASE_URL.replace(/\/api$/, '');
    try {
      // Mint a token: the preview subdomain is a different origin with no session cookie,
      // so the token is how the ingress authenticates the first request.
      const { token } = await getPreviewToken(sandboxId);
      const url = toPreviewUrl(rawUrl, sandboxId, gatewayOrigin, token);
      if (url) onPreview(url);
    } catch (e) {
      toast.error(`Could not open preview: ${(e as Error).message}`);
    }
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