// frontend/src/terminal/components/TerminalContextMenu.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@iconify/react';
import { TerminalHandle } from './Terminal';

interface TerminalContextMenuProps {
  x: number;
  y: number;
  isVisible: boolean;
  selectedText: string;     // receives our copied snapshot
  onClose: () => void;
  terminalRef: React.RefObject<TerminalHandle | null>;
}

export const TerminalContextMenu = ({ x, y, isVisible, selectedText, onClose, terminalRef }: TerminalContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isCopied, setIsCopied] = useState(false); // State for animation

  useEffect(() => {
   if (!isVisible) {
      setIsCopied(false); // Reset animation state when closed
      return;
    }
    
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const handleCopy = async () => {
    // Use the safe snapshot, not getSelection()
    if (selectedText) {
      await navigator.clipboard.writeText(selectedText);
      
      // Trigger the animation
      setIsCopied(true);
      
      // Close the menu automatically after 1 second so they see the checkmark
      setTimeout(() => {
        onClose();
      }, 1000);
    } else {
      onClose(); // If nothing was selected, just close immediately
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      terminalRef.current?.write(text); 
      terminalRef.current?.scrollToBottom(); // <--- Snap to bottom on menu paste!
    } catch (err) {
      console.error('Failed to read clipboard', err);
    }
    onClose();
  };

  const handleClear = () => {
    terminalRef.current?.clear();
    onClose();
  };

  return (
    <div 
      ref={menuRef}
      style={{ top: y, left: x }}
      className="absolute z-[100] w-48 bg-[#252526] border border-[#454545] rounded shadow-xl py-1 text-[#cccccc] text-sm font-sans"
      onMouseDown={(e) => e.preventDefault()} 
    >
      {/* THE ANIMATED COPY BUTTON */}
      <button 
        onClick={handleCopy} 
        disabled={!selectedText} // Disable if nothing is highlighted
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

      <button onClick={handlePaste} className="w-full text-left px-4 py-1.5 hover:bg-[#04395e] hover:text-white flex items-center gap-2">
        <Icon icon="mdi:content-paste" width={16} /> Paste
      </button>
      
      <div className="h-px bg-[#454545] my-1 mx-2" />
      
      <button onClick={handleClear} className="w-full text-left px-4 py-1.5 hover:bg-[#04395e] hover:text-white flex items-center gap-2">
        <Icon icon="mdi:broom" width={16} /> Clear Buffer
      </button>
    </div>
  );
};