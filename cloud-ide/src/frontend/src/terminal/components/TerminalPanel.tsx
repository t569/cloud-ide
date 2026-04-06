// frontend/src/terminal/components/TerminalPanel.tsx
import React, { useMemo, useRef, useState } from 'react';
import { TerminalComponent, TerminalHandle } from './Terminal';
import { TerminalContextWidget } from './TerminalContextWidget';
import { TerminalSearchWidget } from './TerminalSearchWidget';
import { TerminalContextMenu } from './TerminalContextMenu';
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
  const isolatedEventBus = useMemo(() => new TerminalEventBus(), []);
  
  const [contextMenu, setContextMenu] = useState({ isVisible: false, x: 0, y: 0, selectedText: '' });

  const plugins = useMemo(() => [
    new FileIconPlugin(),
    new LinkSnifferPlugin()
  ], []);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault(); 
    const rect = e.currentTarget.getBoundingClientRect();
    
    // 1. Get raw coordinates relative to the terminal container
    let clickX = e.clientX - rect.left;
    let clickY = e.clientY - rect.top;

    // 2. Define the approximate size of the menu (w-48 is 192px, height is ~140px)
    const MENU_WIDTH = 192;
    const MENU_HEIGHT = 140;

    // 3. COLLISION MATH: Flip the menu up or left if it hits the container boundaries!
    if (clickX + MENU_WIDTH > rect.width) {
      clickX -= MENU_WIDTH; // Shift left
    }
    
    if (clickY + MENU_HEIGHT > rect.height) {
      clickY -= MENU_HEIGHT; // Shift up
    }

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
        position: 'absolute', // <--- FIXED: Absolute positioning prevents the 0x0 canvas collapse
        top: 0, left: 0, right: 0, bottom: 0,
        visibility: isActive ? 'visible' : 'hidden', // <--- FIXED: Visibility instead of display: none
        zIndex: isActive ? 10 : 0
      }}
    >
      <TerminalContextWidget 
        eventBus={isolatedEventBus} 
        onFileClick={onFileClick} 
        onLinkClick={onLinkClick} 
      />

      <div className="flex-1 overflow-hidden relative min-h-0">
        <TerminalContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          isVisible={contextMenu.isVisible}
          // Pass the captured text as a prop!
          selectedText={contextMenu.selectedText} 
          onClose={() => setContextMenu({ ...contextMenu, isVisible: false })}
          terminalRef={terminalRef}
        />

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