// frontend/src/terminal/components/TerminalTabs.tsx

/**
 * @fileoverview Terminal Session Multiplexer and UI Tab Manager.
 * This component acts as the orchestrator for multiple concurrent terminal instances.
 * It renders a VS Code-style tab bar and manages the visibility state of the underlying 
 * TerminalPanels. 
 * * ARCHITECTURE NOTE (Simultaneous Mounting):
 * Notice that this component iterates through all `initialSessions` and renders a 
 * `<TerminalPanel>` for EVERY session, regardless of which one is active. We rely on 
 * the `isActive` prop to tell the child panel to visually hide itself. We do NOT 
 * unmount inactive tabs. If we unmounted them, the WebGL canvas would be destroyed 
 * and background processes (like build logs) would lose their visual history.
 */

import React, { useState } from 'react';
import { Icon } from '@iconify/react';
import { TerminalPanel } from './TerminalPanel';
import { ITransportStream } from '../types/terminal';

/**
 * Represents a single instance of a connected backend terminal.
 */
export interface TerminalSession {
  /** Unique identifier for the session (e.g., UUID or timestamp). */
  id: string;
  /** Human-readable title displayed on the tab (e.g., 'bash-1', 'node-pty'). */
  title: string;
  /** The isolated data stream linking this specific session to the backend daemon. */
  transport: ITransportStream;
}

/**
 * Props for the TerminalTabs multiplexer.
 */
interface TerminalTabsProps {
  /** The array of active terminal sessions managed by the parent workspace. */
  initialSessions: TerminalSession[];
  /** Callback fired when the user clicks the '+' button to spin up a new PTY. */
  onAddTab: () => void;
  /** Callback fired when the user clicks the 'x' button to kill a PTY. */
  onCloseTab: (id: string) => void;
  /** Passthrough callback for the Context HUD: fired when a file is clicked. */
  onFileClick: (file: string) => void;
  /** Passthrough callback for the Context HUD: fired when a URL is clicked. */
  onLinkClick: (url: string) => void;
}

/**
 * Renders the terminal tab bar and manages the layout of the terminal panels.
 * * @param {TerminalTabsProps} props - The component props.
 */
export const TerminalTabs = ({ 
  initialSessions, 
  onAddTab, 
  onCloseTab, 
  onFileClick, 
  onLinkClick 
}: TerminalTabsProps) => {
  
  /** * Tracks which session is currently visible to the user. 
   * Initializes to the first tab if one exists.
   */
  const [activeTabId, setActiveTabId] = useState<string>(
    initialSessions.length > 0 ? initialSessions[0].id : ''
  );

  // ==========================================
  // Action Handlers
  // ==========================================

  /**
   * Gracefully handles the closure of a tab, ensuring the user isn't left 
   * staring at a blank screen if they close the tab they are currently viewing.
   */
  const handleClose = (e: React.MouseEvent, id: string) => {
    // Prevent the click event from bubbling up to the tab's main onClick handler,
    // which would otherwise try to set this closing tab as the active tab.
    e.stopPropagation(); 
    
    // UX Polish: If we are closing the currently active tab, shift focus 
    // to an adjacent tab before actually destroying this one.
    if (id === activeTabId && initialSessions.length > 1) {
      const currentIndex = initialSessions.findIndex(s => s.id === id);
      // Fallback to the previous tab, or the next tab if we are closing the very first one
      const nextTab = initialSessions[currentIndex === 0 ? 1 : currentIndex - 1];
      setActiveTabId(nextTab.id);
    }
    
    // Notify the parent to disconnect the transport and remove the session
    onCloseTab(id);
  };

  // ==========================================
  // Render
  // ==========================================
  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e1e] border border-[#333] rounded overflow-hidden">
      
      {/* ==========================================
          TAB BAR HEADER (VS Code Theme)
          ========================================== */}
      <div className="flex bg-[#252526] overflow-x-auto select-none border-b border-[#333]">
        {initialSessions.map((session) => (
          <div 
            key={session.id}
            onClick={() => setActiveTabId(session.id)}
            className={`flex items-center gap-2 px-3 py-1.5 min-w-[120px] max-w-[200px] border-r border-[#333] cursor-pointer group ${
              activeTabId === session.id 
                // Active State: Blends into the terminal background, adds blue highlight
                ? 'bg-[#1e1e1e] text-[#cccccc] border-t-2 border-t-[#007acc]' 
                // Inactive State: Darker background, invisible top border to prevent layout shifts
                : 'bg-[#2d2d2d] text-[#8a8a8a] border-t-2 border-t-transparent hover:bg-[#2a2d2e]'
            }`}
          >
            <Icon icon="mdi:console-line" className="text-sm" />
            <span className="text-xs font-mono truncate flex-1">{session.title}</span>
            
            {/* Close Button: Only visible on hover or if the tab is active (via group-hover) */}
            <button 
              onClick={(e) => handleClose(e, session.id)}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[#4a4a4a] text-gray-400 hover:text-white"
            >
              <Icon icon="mdi:close" width={14} />
            </button>
          </div>
        ))}
        
        {/* ADD NEW TAB BUTTON */}
        <button 
          onClick={onAddTab}
          className="px-2 py-1.5 text-gray-400 hover:text-white hover:bg-[#2a2d2e] transition-colors"
          title="New Terminal"
        >
          <Icon icon="mdi:plus" width={18} />
        </button>
      </div>

      {/* ==========================================
          TERMINAL PANELS MOUNTING AREA
          ========================================== */}
      {/* CRITICAL LAYOUT FIX: `min-h-0` is strictly required here.
          Because this container is a flex child (`flex-1`), the browser will attempt 
          to let it grow infinitely if its contents overflow. `min-h-0` forces the flexbox 
          to respect the boundaries of the parent, allowing the xterm.js canvas to 
          calculate its own internal scrolling correctly.
      */}
      <div className="flex-1 overflow-hidden relative min-h-0">
        
        {/* Empty State */}
        {initialSessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-500 font-mono text-sm">
            No active terminals. Click '+' to start a session.
          </div>
        ) : (
          
          /* Simultaneous Mounting: We render ALL sessions, but pass `isActive` 
             to let the TerminalPanel handle its own CSS visibility. */
          initialSessions.map((session) => (
            <TerminalPanel
              key={session.id}
              id={session.id}
              transport={session.transport}
              isActive={activeTabId === session.id}
              onFileClick={onFileClick}
              onLinkClick={onLinkClick}
            />
          ))
        )}
      </div>
    </div>
  );
};