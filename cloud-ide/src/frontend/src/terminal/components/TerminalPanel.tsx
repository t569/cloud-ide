// frontend/src/terminal/components/TerminalPanel.tsx
import React, { useMemo, useRef } from 'react';
import { TerminalComponent, TerminalHandle } from './Terminal';
import { TerminalContextWidget } from './TerminalContextWidget';
import { TerminalSearchWidget } from './TerminalSearchWidget';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { FileIconPlugin } from '../core/plugins/FileIconPlugin';
import { LinkSnifferPlugin } from '../core/plugins/LinkSnifferPluggin';
import { ITransportStream } from '../types/terminal';

interface TerminalPanelProps {
  id: string;
  transport: ITransportStream;
  isActive: boolean;
  onFileClick: (file: string) => void;
  onLinkClick: (url: string) => void;
}

export const TerminalPanel = ({ transport, isActive, onFileClick, onLinkClick }: TerminalPanelProps) => {
  const terminalRef = useRef<TerminalHandle>(null);

  // 1. ISOLATION: Every tab gets its own brain (Event Bus) and plugins
  const isolatedEventBus = useMemo(() => new TerminalEventBus(), []);

  // TODO: we might need a better way to add all the plugins
  const plugins = useMemo(() => [
    new FileIconPlugin(),
    new LinkSnifferPlugin()
  ], []);

  return (
    // THE FIX: Stack them like cards. 
    // Absolute positioning + visibility ensures they retain their dimensions!
    <div 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        visibility: isActive ? 'visible' : 'hidden',
        zIndex: isActive ? 10 : 0
      }}
    >
      <TerminalContextWidget 
        eventBus={isolatedEventBus} 
        onFileClick={onFileClick} 
        onLinkClick={onLinkClick} 
      />

      <div className="flex-1 overflow-hidden relative">
        <TerminalSearchWidget 
          terminalRef={terminalRef} 
          eventBus={isolatedEventBus} 
        />
        
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