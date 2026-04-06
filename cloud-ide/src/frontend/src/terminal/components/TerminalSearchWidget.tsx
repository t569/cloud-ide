// frontend/src/terminal/components/TerminalSearchWidget.tsx

/**
 * @fileoverview Floating Local Search UI for the Terminal.
 * This component provides a VS Code-style search bar that floats over the terminal canvas.
 * * ARCHITECTURE NOTE:
 * This widget is entirely decoupled from the DOM keystrokes of the terminal. 
 * The `xterm.js` canvas intercepts the physical "Ctrl+F" keystroke and fires an event 
 * across the `TerminalEventBus`. This widget simply listens for that event to mount itself, 
 * keeping the UI layer cleanly separated from the canvas rendering layer.
 */

import React, { useState, useEffect, useRef } from 'react';
import { TerminalHandle } from './Terminal';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { Icon } from '@iconify/react'; 

/**
 * Props for the TerminalSearchWidget.
 */
interface TerminalSearchWidgetProps {
  /** * A reference to the parent terminal. We use this to imperatively call 
   * `findNext` and `findPrevious` on the underlying xterm SearchAddon. 
   * We accept `null` because the ref might not be populated during the initial render.
   */
  terminalRef: React.RefObject<TerminalHandle | null>;
  /** The central event bus used to listen for the "Ctrl+F" toggle signal. */
  eventBus: TerminalEventBus;
}

/**
 * An interactive, floating search bar that interfaces with the xterm.js SearchAddon.
 * * @param {TerminalSearchWidgetProps} props - The component props.
 */
export const TerminalSearchWidget = ({ terminalRef, eventBus }: TerminalSearchWidgetProps) => {
  /** Controls the mount/unmount state of the widget to keep the DOM clean when not in use. */
  const [isVisible, setIsVisible] = useState(false);
  /** The current search query typed by the user. */
  const [keyword, setKeyword] = useState('');
  /** Ref attached to the physical <input> element so we can forcefully focus it. */
  const inputRef = useRef<HTMLInputElement>(null);

  // ==========================================
  // Event Subscription
  // ==========================================
  useEffect(() => {
    /**
     * Listen for the toggle signal emitted by the `TerminalComponent`'s custom key handler.
     */
    const unsubscribe = eventBus.on('UI_TOGGLE_SEARCH', (payload) => {
      setIsVisible(prev => {
        // Allow the payload to explicitly set visibility, or default to toggling it
        const nextState = payload.isVisible !== undefined ? payload.isVisible : !prev;
        
        // UX POLISH: If the widget is opening, automatically place the user's cursor inside 
        // the input box so they can immediately start typing. We use a 50ms setTimeout 
        // to ensure React has fully painted the <input> element to the DOM before focusing.
        if (nextState) {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
        return nextState;
      });
    });

    return () => { unsubscribe(); };
  }, [eventBus]);

  // ==========================================
  // Action Handlers
  // ==========================================

  /**
   * Executes the search against the terminal's text buffer.
   * @param {'next' | 'prev'} direction - The direction to scan the buffer.
   */
  const handleSearch = (direction: 'next' | 'prev') => {
    if (!keyword) return; // Prevent searching for empty strings
    
    // Command the underlying xterm.js SearchAddon via our imperative handle
    if (direction === 'next') {
      terminalRef.current?.findNext(keyword);
    } else {
      terminalRef.current?.findPrevious(keyword);
    }
  };

  /**
   * Keyboard UX bindings to match standard browser and IDE search behavior.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Shift+Enter goes backwards (up), standard Enter goes forwards (down)
      handleSearch(e.shiftKey ? 'prev' : 'next');
    } else if (e.key === 'Escape') {
      // Close the widget safely
      setIsVisible(false);
      // NOTE: In a future iteration, we should call terminalRef.current?.focus() here 
      // so the user can immediately resume typing in the terminal after closing the search.
    }
  };

  // ==========================================
  // Render
  // ==========================================

  // Do not pollute the DOM if the search is inactive
  if (!isVisible) return null;

  return (
    // Floats in the top-right corner of the terminal panel container
    <div className="absolute top-2 right-4 z-50 flex items-center gap-2 p-1.5 bg-[#252526] border border-[#454545] rounded shadow-lg animate-fade-in-down">
      
      {/* Search Input Box */}
      <input
        ref={inputRef}
        type="text"
        placeholder="Find..."
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onKeyDown={handleKeyDown}
        // Tailwind styling to mimic VS Code's dark theme input boxes
        className="bg-[#3c3c3c] text-white px-2 py-1 text-sm outline-none border border-transparent focus:border-[#007acc] rounded w-48 font-mono"
      />
      
      {/* Search Controls Toolbar */}
      <div className="flex items-center gap-1 text-gray-400">
        
        {/* Previous Match Button */}
        <button 
          onClick={() => handleSearch('prev')} 
          className="p-1 hover:bg-[#4a4a4a] hover:text-white rounded transition-colors"
          title="Previous Match (Shift+Enter)"
        >
          <Icon icon="mdi:arrow-up" />
        </button>
        
        {/* Next Match Button */}
        <button 
          onClick={() => handleSearch('next')} 
          className="p-1 hover:bg-[#4a4a4a] hover:text-white rounded transition-colors"
          title="Next Match (Enter)"
        >
          <Icon icon="mdi:arrow-down" />
        </button>
        
        {/* Vertical Divider */}
        <div className="w-px h-4 bg-gray-600 mx-1" />
        
        {/* Close Button */}
        <button 
          onClick={() => setIsVisible(false)} 
          className="p-1 hover:bg-[#f48771] hover:text-white rounded transition-colors"
          title="Close (Esc)"
        >
          <Icon icon="mdi:close" />
        </button>
        
      </div>
    </div>
  );
};