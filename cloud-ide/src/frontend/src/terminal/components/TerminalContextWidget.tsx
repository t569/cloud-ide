// frontend/src/terminal/components/TerminalContextWidget.tsx
import React, { useEffect, useState } from 'react';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { FileIcon } from '@frontend/common/FileIcon';
import { Icon } from '@iconify/react';

/**
 * Props for the TerminalContextWidget.
 * * This interface strictly demands a shared Event Bus so the widget 
 * can listen to the exact same event stream as the core terminal canvas.
 */
interface TerminalContextWidgetProps {
  /** The central nervous system connecting the terminal to plugins and UI. */
  eventBus: TerminalEventBus;
  /** Callback fired when a user clicks a file suggestion (e.g., to open it in the editor). */
  onFileClick?: (fileName: string) => void;
  /** Callback fired when a user clicks a link: direct it to the right endpoint */
  onLinkClick?: (url: string) => void;
}

/**
 * A reactive UI overlay that displays context-aware suggestions (like clickable files)
 * based on the user's terminal activity.
 * * **Architectural Note:** This component is completely decoupled from `xterm.js`. 
 * It knows nothing about the backend transport or the terminal canvas. It acts 
 * strictly as a View layer, listening to the Event Bus and rendering React state.
 * If there are no active suggestions, it returns `null` to take up zero DOM space.
 * * @param {TerminalContextWidgetProps} props - The component props.
 * @returns {JSX.Element | null} The context widget bar, or null if empty.
 */
export const TerminalContextWidget = ({ eventBus, onFileClick, onLinkClick }: TerminalContextWidgetProps) => {
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [contextLinks, setContextLinks] = useState<string[]>([]);

  useEffect(() => {
    // Subscribe to UI suggestions from the Event Bus
    /**
     * Subscribe to UI suggestions broadcasted by terminal plugins.
     * For example, the FileIconPlugin will emit an array of detected files here.
     */
    const unsubscribe = eventBus.on('UI_CONTEXT_SUGGESTED', (payload) => {
      if (payload.type === 'files') {
        setContextFiles(prev => {
          // An empty array is the standard signal to clear the UI (e.g., when a new command starts)
          if (payload.items.length === 0) return []; 
          
            // Merge newly detected files with existing ones, removing duplicates.
            // We strictly limit the UI to the 8 most recent files to prevent the widget 
            // from overflowing and cluttering the IDE workspace.
            const merged = Array.from(new Set([...payload.items, ...prev]));
            return merged.slice(0, 8);
        });
      }

      // Handle Links (NEW LOGIC)
      if (payload.type === 'links') {
        setContextLinks(prev => {
          if (payload.items.length === 0) return []; 
          return Array.from(new Set([...payload.items, ...prev])).slice(0, 3);
        });
      }

    });

    /**
     * Component Teardown
     * We wrap the unsubscribe call in curly braces `{ unsubscribe(); }` rather than 
     * using an implicit arrow return `() => unsubscribe()`. This prevents TypeScript 
     * from complaining about returning a boolean (from Set.delete) to React's EffectCallback, 
     * which strictly expects a void return type.
     */
    return () => {unsubscribe()};
  }, [eventBus]);

  // If there's nothing to show, render nothing (takes up 0px of space)
  if (contextFiles.length === 0 && contextLinks.length === 0) return null;

 return (
    <div className="flex items-center gap-4 p-2 bg-[#1e1e1e] border-b border-[#333] shadow-sm overflow-x-auto">
      <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider select-none">
        Context:
      </span>
      
      <div className="flex gap-2 items-center">
        {/* Render Links First (They are usually more important if a server is running) */}
        {contextLinks.map((link) => (
          <button 
            key={link} 
            onClick={() => onLinkClick && onLinkClick(link)}
            className="flex items-center gap-2 px-3 py-1 bg-[#094771] hover:bg-[#0d629a] text-blue-100 rounded text-sm font-mono transition-colors border border-[#115a8c]"
            title={`Open Preview for ${link}`}
          >
            <Icon icon="mdi:web" width={16} /> {/* A globe icon */}
            Open {link}
          </button>
        ))}

        {/* Optional Divider if we have both */}
        {contextLinks.length > 0 && contextFiles.length > 0 && (
          <div className="h-4 w-px bg-gray-600 mx-1" />
        )}

        {/* Render Files (Existing Logic) */}
        {contextFiles.map((file) => (
          <button 
            key={file} 
            onClick={() => onFileClick && onFileClick(file)}
            className="flex items-center gap-2 px-2 py-1 bg-[#2d2d2d] hover:bg-[#3d3d3d] rounded text-sm text-gray-300 font-mono transition-colors border border-[#444]"
          >
            <FileIcon fileName={file} size={16} />
            {file}
          </button>
        ))}
      </div>
    </div>
  );
};