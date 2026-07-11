// frontend/src/editor/components/EditorTabs.tsx
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
      const el = scrollContainerRef.current.querySelector('[data-active="true"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [activeFilePath, openFiles.length]);

  return (
    <div
      ref={scrollContainerRef}
      className="no-scrollbar flex h-9 flex-shrink-0 select-none items-center gap-1 overflow-x-auto border-b border-ide-border bg-ide-bg px-2"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {openFiles.length === 0 ? (
        <span className="px-2 text-xs italic text-ide-muted">No files open</span>
      ) : (
        openFiles.map((file) => {
          const isActive = activeFilePath === file.path;
          const filename = getFilename(file.path);

          return (
            <div
              key={file.path}
              data-active={isActive}
              onClick={() => eventBus.emit('TAB_ACTIVATED', { path: file.path })}
              className={`group relative flex h-7 cursor-pointer items-center gap-2 rounded-md pl-2.5 pr-1.5 transition-colors ${
                isActive ? 'bg-ide-hover text-ide-text' : 'text-ide-muted hover:bg-ide-hover/60 hover:text-ide-text'
              }`}
            >
              {/* Accent underline marks the active tab. */}
              {isActive && (
                <span className="absolute inset-x-2.5 bottom-0 h-0.5 rounded-full bg-ide-accent" />
              )}

              <FileIcon fileName={filename} className="h-4 w-4 flex-shrink-0" />

              <span
                className={`whitespace-nowrap text-[13px] font-sans ${
                  file.isDeleted ? 'italic text-red-400/80 line-through' : ''
                }`}
              >
                {filename}
              </span>

              {/* Dirty dot when inactive+unsaved; otherwise the close affordance. */}
              <span className="ml-1 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                {file.isDirty && !isActive ? (
                  <span className="h-2 w-2 rounded-full bg-ide-accent" />
                ) : (
                  <button
                    aria-label={`Close ${filename}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      eventBus.emit('TAB_CLOSED', { path: file.path });
                    }}
                    className={`rounded p-0.5 text-ide-muted transition-all hover:bg-ide-border hover:text-ide-text ${
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"
                      />
                    </svg>
                  </button>
                )}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
};
