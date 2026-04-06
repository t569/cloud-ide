// frontend/src/terminal/components/TerminalContextWidget.tsx

/**
 * @fileoverview Floating Context HUD (Heads-Up Display) for the Terminal.
 * This component acts as a reactive UI overlay. It listens for events emitted by 
 * terminal background processes (like sniffing URLs or file paths in the output) 
 * and renders actionable "badges" allowing the user to click them.
 * * * ARCHITECTURE NOTE (Decoupled View):
 * This component is entirely decoupled from `xterm.js`. It knows nothing about 
 * the canvas, the backend transport, or how text is rendered. It strictly acts 
 * as a View layer, subscribing to the shared `TerminalEventBus`. If no suggestions 
 * are active, it returns `null` to collapse and take up zero DOM space.
 */

import React, { useEffect, useState } from 'react';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { FileIcon } from '@frontend/common/FileIcon';
import { Icon } from '@iconify/react';

/**
 * Props for the TerminalContextWidget.
 * This interface strictly demands a shared Event Bus so the widget 
 * can listen to the exact same event stream as the core terminal canvas.
 */
interface TerminalContextWidgetProps {
  /** The central event bus connecting the terminal to plugins and UI components. */
  eventBus: TerminalEventBus;
  /** Callback fired when a user clicks the primary area of a file badge. */
  onFileClick?: (fileName: string) => void;
  /** Callback fired when a user clicks the primary area of a link badge. */
  onLinkClick?: (url: string) => void;
}

/**
 * A reactive UI overlay that displays context-aware, dismissible suggestions.
 * * @param {TerminalContextWidgetProps} props - The component props.
 */
export const TerminalContextWidget = ({ eventBus, onFileClick, onLinkClick }: TerminalContextWidgetProps) => {
  // Local state holding the currently active suggestions
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  const [contextLinks, setContextLinks] = useState<string[]>([]);

  // ==========================================
  // Event Subscription
  // ==========================================
  useEffect(() => {
    /**
     * Subscribe to UI suggestions broadcasted by terminal plugins (like LinkSnifferPlugin).
     */
    const unsubscribe = eventBus.on('UI_CONTEXT_SUGGESTED', (payload) => {
      
      // 1. Handle File Suggestions
      if (payload.type === 'files') {
        setContextFiles(prev => {
          // An empty array is the standard signal to clear the UI (e.g., when a new command starts)
          if (payload.items.length === 0) return []; 
          
          // Merge newly detected files with existing ones, removing duplicates via Set.
          // We strictly limit the UI to the 8 most recent files to prevent the widget 
          // from overflowing and cluttering the IDE workspace.
          const merged = Array.from(new Set([...payload.items, ...prev]));
          return merged.slice(0, 8);
        });
      }

      // 2. Handle Network/Localhost Link Suggestions
      if (payload.type === 'links') {
        setContextLinks(prev => {
          if (payload.items.length === 0) return []; 
          // Cap at 3 active links to save horizontal space
          return Array.from(new Set([...payload.items, ...prev])).slice(0, 3);
        });
      }
    });

    /**
     * Component Teardown
     * Unsubscribes from the EventBus to prevent memory leaks if this tab is closed.
     */
    return () => { unsubscribe(); };
  }, [eventBus]);

  // ==========================================
  // Dismissal Handlers
  // ==========================================
  
  const handleRemoveFile = (fileToRemove: string) => {
    setContextFiles(prev => prev.filter(f => f !== fileToRemove));
  };

  const handleRemoveLink = (linkToRemove: string) => {
    setContextLinks(prev => prev.filter(l => l !== linkToRemove));
  };

  // ==========================================
  // Render
  // ==========================================

  // If there's nothing to show, return null to completely collapse the HUD
  if (contextFiles.length === 0 && contextLinks.length === 0) return null;

  return (
    <div className="flex items-center gap-4 p-2 bg-[#1e1e1e] border-b border-[#333] shadow-sm overflow-x-auto custom-scrollbar">
      <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider select-none shrink-0">
        Context:
      </span>
      
      <div className="flex gap-2 items-center">
        
        {/* --- LINKS --- (Rendered first as they often indicate active servers) */}
        {contextLinks.map((link) => (
          // Notice we use a div wrapper now instead of a button to allow two distinct click targets
          <div 
            key={link} 
            className="flex items-center bg-[#094771] hover:bg-[#0d629a] text-blue-100 rounded border border-[#115a8c] transition-colors group"
          >
            {/* Primary Action Target */}
            <button 
              onClick={() => onLinkClick && onLinkClick(link)}
              className="flex items-center gap-2 px-3 py-1 text-sm font-mono"
              title={`Open Preview for ${link}`}
            >
              <Icon icon="mdi:web" width={16} /> 
              Open {link}
            </button>
            
            {/* Dismiss ('X') Target */}
            <button 
              onClick={() => handleRemoveLink(link)}
              className="pr-2 pl-1 py-1 text-blue-300 hover:text-white opacity-70 hover:opacity-100 transition-opacity"
              title="Dismiss link"
            >
              <Icon icon="mdi:close" width={14} />
            </button>
          </div>
        ))}

        {/* --- DIVIDER --- */}
        {contextLinks.length > 0 && contextFiles.length > 0 && (
          <div className="h-4 w-px bg-gray-600 mx-1 shrink-0" />
        )}

        {/* --- FILES --- */}
        {contextFiles.map((file) => (
          <div 
            key={file} 
            className="flex items-center bg-[#2d2d2d] hover:bg-[#3d3d3d] rounded text-gray-300 border border-[#444] transition-colors group"
          >
            {/* Primary Action Target */}
            <button 
              onClick={() => onFileClick && onFileClick(file)}
              className="flex items-center gap-2 px-2 py-1 text-sm font-mono"
              title={`Open ${file}`}
            >
              <FileIcon fileName={file} size={16} />
              {file}
            </button>

            {/* Dismiss ('X') Target */}
            <button 
              onClick={() => handleRemoveFile(file)}
              className="pr-2 pl-1 py-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              title="Dismiss file"
            >
              <Icon icon="mdi:close" width={14} />
            </button>
          </div>
        ))}

      </div>
    </div>
  );
};