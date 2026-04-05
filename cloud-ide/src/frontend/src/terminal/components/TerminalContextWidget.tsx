// frontend/src/terminal/components/TerminalContextWidget.tsx
import React, { useEffect, useState } from 'react';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { FileIcon } from '@frontend/common/FileIcon';

interface TerminalContextWidgetProps {
  eventBus: TerminalEventBus;
  onFileClick?: (fileName: string) => void;
}

export const TerminalContextWidget = ({ eventBus, onFileClick }: TerminalContextWidgetProps) => {
  const [contextFiles, setContextFiles] = useState<string[]>([]);

  useEffect(() => {
    // Subscribe to UI suggestions from the Event Bus
    const unsubscribe = eventBus.on('UI_CONTEXT_SUGGESTED', (payload) => {
      if (payload.type === 'files') {
        setContextFiles(prev => {
          if (payload.items.length === 0) return []; // Clear state
          
          // Merge new items, keep only the latest 8 to prevent UI clutter
          const merged = Array.from(new Set([...payload.items, ...prev]));
          return merged.slice(0, 8);
        });
      }
    });

    return () => {unsubscribe()};
  }, [eventBus]);

  // If there's nothing to show, render nothing (takes up 0px of space)
  if (contextFiles.length === 0) return null;

  return (
    <div className="flex items-center gap-3 p-2 bg-[#1e1e1e] border-b border-[#333] shadow-sm overflow-x-auto animate-fade-in">
      <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider select-none">
        Context:
      </span>
      
      <div className="flex gap-2">
        {contextFiles.map((file) => (
          <button 
            key={file} 
            onClick={() => onFileClick && onFileClick(file)}
            className="flex items-center gap-2 px-2 py-1 bg-[#2d2d2d] hover:bg-[#3d3d3d] rounded text-sm text-gray-300 font-mono transition-colors border border-[#444]"
            title={`Open ${file} in editor`}
          >
            <FileIcon fileName={file} size={16} />
            {file}
          </button>
        ))}
      </div>
    </div>
  );
};