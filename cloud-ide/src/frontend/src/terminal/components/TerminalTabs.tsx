// frontend/src/terminal/components/TerminalTabs.tsx
import React, { useState } from 'react';
import { Icon } from '@iconify/react';
import { TerminalPanel } from './TerminalPanel';
import { ITransportStream } from '../types/terminal';

export interface TerminalSession {
  id: string;
  title: string;
  transport: ITransportStream;
}

interface TerminalTabsProps {
  initialSessions: TerminalSession[];
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onFileClick: (file: string) => void;
  onLinkClick: (url: string) => void;
}

export const TerminalTabs = ({ 
  initialSessions, 
  onAddTab, 
  onCloseTab, 
  onFileClick, 
  onLinkClick 
}: TerminalTabsProps) => {
  
  // Track which tab is currently visible
  const [activeTabId, setActiveTabId] = useState<string>(
    initialSessions.length > 0 ? initialSessions[0].id : ''
  );

  const handleClose = (e: React.MouseEvent, id: string) => {
    e.stopPropagation(); // Don't trigger the tab switch when clicking the 'X'
    
    // If we close the active tab, switch focus to another one
    if (id === activeTabId && initialSessions.length > 1) {
      const currentIndex = initialSessions.findIndex(s => s.id === id);
      const nextTab = initialSessions[currentIndex === 0 ? 1 : currentIndex - 1];
      setActiveTabId(nextTab.id);
    }
    onCloseTab(id);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e1e] border border-[#333] rounded overflow-hidden">
      
      {/* === TAB BAR HEADER === */}
      <div className="flex bg-[#252526] overflow-x-auto select-none border-b border-[#333]">
        {initialSessions.map((session) => (
          <div 
            key={session.id}
            onClick={() => setActiveTabId(session.id)}
            className={`flex items-center gap-2 px-3 py-1.5 min-w-[120px] max-w-[200px] border-r border-[#333] cursor-pointer group ${
              activeTabId === session.id 
                ? 'bg-[#1e1e1e] text-[#cccccc] border-t-2 border-t-[#007acc]' 
                : 'bg-[#2d2d2d] text-[#8a8a8a] border-t-2 border-t-transparent hover:bg-[#2a2d2e]'
            }`}
          >
            <Icon icon="mdi:console-line" className="text-sm" />
            <span className="text-xs font-mono truncate flex-1">{session.title}</span>
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

      {/* === TERMINAL PANELS === */}
      <div className="flex-1 overflow-hidden relative">
        {initialSessions.length === 0 ? (
          <div className="flex h-full items-center justify-center text-gray-500 font-mono text-sm">
            No active terminals. Click '+' to start a session.
          </div>
        ) : (
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