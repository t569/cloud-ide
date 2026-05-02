import React, { useRef, useEffect } from 'react';
import { FileIcon } from '@frontend/common/FileIcon';
import { OpenFileContext, EditorEventPayloads } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';


interface EditorTabsProps {
  activeFilePath: string | null;
  openFiles: OpenFileContext[];
  eventBus: EditorEventBus;
}

export const EditorTabs = ({ activeFilePath, openFiles, eventBus }: EditorTabsProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const getFilename = (path: string) => path.split('/').pop() || path;

  useEffect(() => {
    if (activeFilePath && scrollContainerRef.current) {
      const activeElement = scrollContainerRef.current.querySelector('[data-active="true"]');
      if (activeElement) {
        // FIX: Changed 'auto' to 'nearest' to satisfy TypeScript's ScrollLogicalPosition
        activeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }, [activeFilePath, openFiles.length]);

  return (
    <div 
      ref={scrollContainerRef}
      // UI FIX: Added padding, gap, and removed the bottom border for the floating pill look
      className="h-12 bg-[#1e1e1e] flex items-center px-3 gap-2 flex-shrink-0 overflow-x-auto select-none no-scrollbar"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }} 
    >
      {openFiles.length === 0 ? (
        <div className="text-xs text-gray-500 italic px-2">No files open</div>
      ) : (
        openFiles.map((file) => {
          const isActive = activeFilePath === file.path;
          const filename = getFilename(file.path);

          return (
            <div
              key={file.path}
              data-active={isActive}
              onClick={() => eventBus.emit('TAB_ACTIVATED', { path: file.path })}
              className={`
                group flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-colors border border-transparent
                ${isActive 
                  // Active State: Lighter gray background, distinct text
                  ? 'bg-[#313338] text-[#dbdee1]' 
                  // Inactive State: Darker background, dims text, hover effect
                  : 'bg-[#2b2d31] text-[#949ba4] hover:bg-[#313338] hover:text-[#dbdee1]'
                }
              `}
            >
              {/* Optional Icon Hookup (You can remove this if you strictly want text only like the image) */}
              <div className="flex-shrink-0">
                <FileIcon fileName={filename} className="w-4 h-4" />
              </div>

              <span className="text-sm font-sans whitespace-nowrap">
                {filename}
              </span>

              {/* Close Button & Dirty State */}
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 ml-1">
                {file.isDirty && !isActive ? (
                  <div className="w-2 h-2 rounded-full bg-white opacity-80" />
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      eventBus.emit('TAB_CLOSED', { path: file.path });
                    }}
                    className={`
                      p-0.5 rounded text-gray-400 hover:text-white hover:bg-[#4a4a4a] transition-all
                      ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                    `}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path fillRule="evenodd" clipRule="evenodd" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};