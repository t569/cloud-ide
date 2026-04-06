// frontend/src/terminal/components/TerminalContextMenu.tsx

/**
 * @fileoverview Custom Context Menu for the Terminal Canvas.
 * Native browser right-click menus are notoriously buggy when interacting with 
 * <canvas> elements (which xterm.js uses). Specifically, interacting with a custom 
 * UI menu typically steals the browser's "focus", causing xterm.js to immediately 
 * clear the user's highlighted text selection.
 * * This component solves that using a "Snapshot Strategy" (receiving the text 
 * captured BEFORE the menu opens) and "Focus Protection" (preventing the menu 
 * from stealing DOM focus).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { TerminalHandle } from './Terminal';

/**
 * Props for the TerminalContextMenu component.
 */
interface TerminalContextMenuProps {
  /** The absolute X coordinate (in pixels) to render the menu. */
  x: number;
  /** The absolute Y coordinate (in pixels) to render the menu. */
  y: number;
  /** Controls whether the menu is currently mounted/visible. */
  isVisible: boolean;
  /** * The text snapshot captured by the parent component the exact millisecond 
   * the user right-clicked. This bypasses the bug where xterm.js clears its 
   * selection when losing focus to this menu.
   */
  selectedText: string;     
  /** Callback fired when the user clicks an action or clicks outside the menu. */
  onClose: () => void;
  /** React Ref pointing to the TerminalHandle to execute imperative commands (paste/clear). */
  terminalRef: React.RefObject<TerminalHandle | null>;
}

/**
 * A floating, absolute-positioned context menu providing standard terminal clipboard operations.
 * * @param {TerminalContextMenuProps} props - The component props.
 */
export const TerminalContextMenu = ({ x, y, isVisible, selectedText, onClose, terminalRef }: TerminalContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  
  /** State to manage the visual "Copied!" feedback animation. */
  const [isCopied, setIsCopied] = useState(false); 

  // ==========================================
  // Lifecycle & Outside-Click Detection
  // ==========================================
  useEffect(() => {
   if (!isVisible) {
      // Ensure the button text resets to "Copy" the next time the menu opens
      setIsCopied(false); 
      return;
    }
    
    /**
     * Closes the menu if the user clicks anywhere else on the screen.
     */
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Listen for mousedown instead of click to react faster and match native OS behavior
    document.addEventListener('mousedown', handleClickOutside);
    
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  // Take up zero DOM space if hidden
  if (!isVisible) return null;

  // ==========================================
  // Action Handlers
  // ==========================================

  /**
   * Writes the snapshot text to the system clipboard and triggers the success animation.
   */
  const handleCopy = async () => {
    // We strictly use the safe snapshot, NOT terminalRef.current.getSelection(),
    // because by the time this runs, the live selection might have already cleared.
    if (selectedText) {
      await navigator.clipboard.writeText(selectedText);
      
      // Trigger the UI feedback animation (turns the button green)
      setIsCopied(true);
      
      // Auto-close the menu after 1 second so the user can see the "Copied!" checkmark
      setTimeout(() => {
        onClose();
      }, 1000);
    } else {
      // Failsafe: If nothing was selected somehow, just close immediately
      onClose(); 
    }
  };

  /**
   * Reads from the system clipboard, pipes the data to the backend, and scrolls the view.
   */
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      
      // Pipe the pasted text into the terminal's input stream
      terminalRef.current?.write(text); 
      
      // UX Polish: If the user pasted a massive block of text, snap the viewport 
      // back down to the bottom so they can see the resulting prompt.
      terminalRef.current?.scrollToBottom(); 
    } catch (err) {
      console.error('Failed to read clipboard', err);
    }
    onClose();
  };

  /**
   * Wipes the terminal's visible canvas and memory buffer.
   */
  const handleClear = () => {
    terminalRef.current?.clear();
    onClose();
  };

  // ==========================================
  // Render
  // ==========================================
  return (
    <div 
      ref={menuRef}
      style={{ top: y, left: x }}
      className="absolute z-[100] w-48 bg-[#252526] border border-[#454545] rounded shadow-xl py-1 text-[#cccccc] text-sm font-sans"
      
      // CRITICAL FIX: "Focus Protection"
      // e.preventDefault() on mousedown stops the browser from shifting the active 
      // DOM focus away from the xterm.js <textarea>. If focus shifts, xterm.js 
      // automatically erases the user's highlighted text selection!
      onMouseDown={(e) => e.preventDefault()} 
    >
      {/* --- COPY BUTTON --- */}
      <button 
        onClick={handleCopy} 
        disabled={!selectedText} // Disable the button entirely if no text was highlighted
        className={`w-full text-left px-4 py-1.5 flex items-center gap-2 transition-colors duration-200 ${
          isCopied 
            ? 'bg-green-600/20 text-green-400' 
            : !selectedText 
              ? 'text-gray-600 cursor-not-allowed' 
              : 'hover:bg-[#04395e] hover:text-white'
        }`}
      >
        <Icon icon={isCopied ? "mdi:check-circle" : "mdi:content-copy"} width={16} /> 
        {isCopied ? 'Copied!' : 'Copy'}
      </button>

      {/* --- PASTE BUTTON --- */}
      <button onClick={handlePaste} className="w-full text-left px-4 py-1.5 hover:bg-[#04395e] hover:text-white flex items-center gap-2">
        <Icon icon="mdi:content-paste" width={16} /> Paste
      </button>
      
      <div className="h-px bg-[#454545] my-1 mx-2" />
      
      {/* --- CLEAR BUTTON --- */}
      <button onClick={handleClear} className="w-full text-left px-4 py-1.5 hover:bg-[#04395e] hover:text-white flex items-center gap-2">
        <Icon icon="mdi:broom" width={16} /> Clear Buffer
      </button>
    </div>
  );
};