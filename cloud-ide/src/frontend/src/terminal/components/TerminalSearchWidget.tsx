// frontend/src/terminal/components/TerminalSearchWidget.tsx
import React, { useState, useEffect, useRef } from 'react';
import { TerminalHandle } from './Terminal';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { Icon } from '@iconify/react'; 
interface TerminalSearchWidgetProps {
  terminalRef: React.RefObject<TerminalHandle | null >;
  eventBus: TerminalEventBus;
}

export const TerminalSearchWidget = ({ terminalRef, eventBus }: TerminalSearchWidgetProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [keyword, setKeyword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = eventBus.on('UI_TOGGLE_SEARCH', (payload) => {
      setIsVisible(prev => {
        const nextState = payload.isVisible !== undefined ? payload.isVisible : !prev;
        // If we are opening it, focus the input field immediately
        if (nextState) {
          setTimeout(() => inputRef.current?.focus(), 50);
        }
        return nextState;
      });
    });

    return () => { unsubscribe(); };
  }, [eventBus]);

  const handleSearch = (direction: 'next' | 'prev') => {
    if (!keyword) return;
    if (direction === 'next') terminalRef.current?.findNext(keyword);
    else terminalRef.current?.findPrevious(keyword);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Shift+Enter goes backwards, Enter goes forwards (standard browser behavior)
      handleSearch(e.shiftKey ? 'prev' : 'next');
    } else if (e.key === 'Escape') {
      setIsVisible(false);
      // Give focus back to the terminal when closing the search
      // Assuming your TerminalHandle exposes a focus() method, otherwise you might need to add it!
    }
  };

  if (!isVisible) return null;

  return (
    <div className="absolute top-2 right-4 z-50 flex items-center gap-2 p-1.5 bg-[#252526] border border-[#454545] rounded shadow-lg animate-fade-in-down">
      <input
        ref={inputRef}
        type="text"
        placeholder="Find..."
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onKeyDown={handleKeyDown}
        className="bg-[#3c3c3c] text-white px-2 py-1 text-sm outline-none border border-transparent focus:border-[#007acc] rounded w-48 font-mono"
      />
      
      <div className="flex items-center gap-1 text-gray-400">
        <button 
          onClick={() => handleSearch('prev')} 
          className="p-1 hover:bg-[#4a4a4a] hover:text-white rounded transition-colors"
          title="Previous Match (Shift+Enter)"
        >
          <Icon icon="mdi:arrow-up" />
        </button>
        <button 
          onClick={() => handleSearch('next')} 
          className="p-1 hover:bg-[#4a4a4a] hover:text-white rounded transition-colors"
          title="Next Match (Enter)"
        >
          <Icon icon="mdi:arrow-down" />
        </button>
        <div className="w-px h-4 bg-gray-600 mx-1" />
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