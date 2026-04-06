// frontend/src/terminal/components/TerminalPanel.tsx

/**
 * @fileoverview The Isolated Terminal Sandbox Component.
 * In a multiplexed (multi-tab) environment, multiple terminal instances run simultaneously.
 * If they share the same Event Bus, a background `npm install` in Tab 2 would trigger 
 * UI popups in Tab 1. 
 * * This component acts as an Isolation Layer. It bundles a single xterm canvas, 
 * a private Event Bus, isolated UI widgets (Search, Context HUD, Right-Click Menu), 
 * and specific plugins into a single, self-contained DOM node.
 */

import React, { useMemo, useRef, useState } from 'react';

// WIDGETS
import { TerminalComponent, TerminalHandle } from './Terminal';
import { TerminalContextWidget } from './TerminalContextWidget';
import { TerminalSearchWidget } from './TerminalSearchWidget';
import { TerminalContextMenu } from './TerminalContextMenu';

// EVENT HANDLER
import { TerminalEventBus } from '../core/TerminalEventBus';

// PLUGINS
import { TerminalRegistry } from '../core/TerminalRegistry';
import { FileIconPlugin } from '../core/plugins/FileIconPlugin';
import { LinkSnifferPlugin } from '../core/plugins/LinkSnifferPluggin'; 

// TRANSPORT LAYER
import { ITransportStream } from '../types/terminal';

/**
 * Props for the TerminalPanel.
 */
interface TerminalPanelProps {
  /** Unique identifier for this terminal session (e.g., 'term-12345'). */
  id: string;
  /** The backend data stream (WebSocket or Mock) connected strictly to this panel. */
  transport: ITransportStream;
  /** Whether this panel is the currently visible tab in the UI. */
  isActive: boolean;
  /** Callback fired when a file is clicked in the Context HUD. */
  onFileClick: (file: string) => void;
  /** Callback fired when a URL is clicked in the Context HUD. */
  onLinkClick: (url: string) => void;
}

/**
 * A self-contained terminal environment that manages its own layout, events, and UI overlays.
 * * @param {TerminalPanelProps} props - The component props.
 */
export const TerminalPanel = ({ transport, isActive, onFileClick, onLinkClick }: TerminalPanelProps) => {
  /** Ref to directly command the underlying xterm.js instance. */
  const terminalRef = useRef<TerminalHandle>(null);
  
  // ==========================================
  // Event Isolation
  // ==========================================
  // We initialize the EventBus inside useMemo so it is instantiated exactly once 
  // per panel. This guarantees that file/link events sniffed in this terminal 
  // do not bleed into the UI of other active tabs.
  const isolatedEventBus = useMemo(() => new TerminalEventBus(), []);

  // register all the plugins in our registry
  const plugins = useMemo(() => 
    TerminalRegistry.getDefaultPlugins()
  , []);

  // State to control the floating custom right-click menu
  const [contextMenu, setContextMenu] = useState({ isVisible: false, x: 0, y: 0, selectedText: '' });

  // ==========================================
  // Context Menu Interceptor & Math
  // ==========================================
  /**
   * Intercepts the native browser right-click to mount our custom VS Code-style menu.
   */
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); // Stop the native browser menu from appearing
    
    // Calculate the bounding box of the terminal panel
    const rect = e.currentTarget.getBoundingClientRect();
    
    // 1. Get raw coordinates relative to the terminal container itself
    let clickX = e.clientX - rect.left;
    let clickY = e.clientY - rect.top;

    // 2. Define the approximate size of the menu (Tailwind w-48 is 192px, height is ~140px)
    const MENU_WIDTH = 192;
    const MENU_HEIGHT = 140;

    // 3. COLLISION MATH: Prevent the menu from rendering off-screen.
    // If the user right-clicks too close to the right or bottom edge, 
    // shift the render coordinates so the menu pops "left" or "up" instead.
    if (clickX + MENU_WIDTH > rect.width) {
      clickX -= MENU_WIDTH; 
    }
    if (clickY + MENU_HEIGHT > rect.height) {
      clickY -= MENU_HEIGHT; 
    }

    // 4. THE SNAPSHOT FIX: Grab the text *before* React state updates and the menu opens.
    // This circumvents the xterm.js bug where canvas focus-loss clears the selection.
    const currentSelection = terminalRef.current?.getSelection() || '';

    setContextMenu({
      isVisible: true,
      x: clickX,
      y: clickY,
      selectedText: currentSelection 
    });
  };

  return (
    <div 
      onContextMenu={handleContextMenu}
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        // ==========================================
        // THE CANVAS RETENTION LAYOUT HACK
        // ==========================================
        // We use absolute positioning and stack all TerminalPanels like a deck of cards.
        // We use `visibility: hidden` instead of `display: none` for inactive tabs.
        // WHY: If `display: none` is used, the browser sets the element's height/width to 0x0. 
        // The xterm.js FitAddon would then squish all text into a single pixel. 
        // Visibility keeps the physical dimensions intact in the DOM so background 
        // processes continue rendering perfectly!
        position: 'absolute', 
        top: 0, left: 0, right: 0, bottom: 0,
        visibility: isActive ? 'visible' : 'hidden', 
        zIndex: isActive ? 10 : 0
      }}
    >
      {/* The Context Widget sits at the top of the panel and ONLY listens 
        to the isolatedEventBus for this specific tab. 
      */}
      <TerminalContextWidget 
        eventBus={isolatedEventBus} 
        onFileClick={onFileClick} 
        onLinkClick={onLinkClick} 
      />

      {/* CRITICAL FIX: min-h-0 forces the flex child to respect the boundaries 
        of its parent. Without this, pasting a massive wall of text causes the 
        container to stretch infinitely downward, breaking the xterm.js scrollbar.
      */}
      <div className="flex-1 overflow-hidden relative min-h-0">
        
        {/* Floating overlays */}
        <TerminalContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          isVisible={contextMenu.isVisible}
          selectedText={contextMenu.selectedText} // Pass the captured text!
          onClose={() => setContextMenu({ ...contextMenu, isVisible: false })}
          terminalRef={terminalRef}
        />

        <TerminalSearchWidget 
          terminalRef={terminalRef} 
          eventBus={isolatedEventBus} 
        />
        
        {/* Core Canvas Wrapper */}
        <TerminalComponent 
          ref={terminalRef}
          theme="dark" 
          transport={transport} 
          plugins={plugins}
          eventBus={isolatedEventBus} 
        />
      </div>
    </div>
  );
};