// frontend/src/editor/components/FileExplorer.tsx
import React, { useState } from 'react';
import { FileIcon } from '@frontend/common/FileIcon';
import { FileNode, EditorEventPayloads } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';
import { dialog } from '../../notifications';

// --- 1. RECURSIVE NODE COMPONENT ---
interface FileExplorerNodeProps {
  node: FileNode;
  level: number;
  activeFilePath: string | null;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  eventBus: EditorEventBus;
}

const FileExplorerNode = ({ 
  node, 
  level, 
  activeFilePath, 
  expandedFolders, 
  toggleFolder,
  eventBus 
}: FileExplorerNodeProps) => {
  const isDir = node.type === 'directory';
  const isExpanded = expandedFolders.has(node.path);
  const isActive = activeFilePath === node.path;

  const handleClick = () => {
    if (isDir) {
      toggleFolder(node.path);
    } else {
      eventBus.emit('FILE_OPEN_REQUESTED', { path: node.path });
    }
  };

  // THE DELETE TRIGGER
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent the file from opening
    const ok = await dialog.confirm({
      title: `Delete ${node.name}?`,
      message:
        node.type === 'directory'
          ? 'This removes the folder and everything inside it. This can’t be undone.'
          : 'This permanently removes the file. This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) eventBus.emit('FILE_DELETED', { path: node.path });
  };

  return (
    <div>
      {/* The Actual Item Row */}
      <div 
        onClick={handleClick}
        className={`
          flex items-center group cursor-pointer mx-2 px-2 py-1.5 rounded-md text-[13px] font-sans transition-colors select-none
          ${isActive 
            ? 'bg-ide-accent/20 text-ide-text font-medium' 
            : 'text-ide-muted hover:bg-ide-hover hover:text-ide-text'
          }
        `}
        style={{ paddingLeft: `${(level * 12) + 8}px` }} 
      >
        {/* Directories: a twisty chevron AND a folder icon (open when expanded),
            so a folder reads as a folder at a glance — matching files, which
            carry their own icon. Files: just their type icon (no chevron). */}
        {isDir ? (
          <>
            <div className="w-4 h-4 mr-0.5 flex items-center justify-center flex-shrink-0 text-ide-muted group-hover:text-ide-text">
              <svg
                width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
                className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
              >
                <path fillRule="evenodd" clipRule="evenodd" d="M5.707 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L9.086 8 5.707 4.707a1 1 0 010-1.414z" />
              </svg>
            </div>
            <div className="w-4 h-4 mr-1.5 flex items-center justify-center flex-shrink-0 text-ide-accent/80">
              {isExpanded ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 5.5A1.5 1.5 0 0 1 5 4h3.6a1.5 1.5 0 0 1 1.06.44L11 5.8h6a1.5 1.5 0 0 1 1.5 1.5V8H6.2a1.5 1.5 0 0 0-1.44 1.08L3 15.5z" />
                  <path d="M3 15.5 4.76 9.08A1.5 1.5 0 0 1 6.2 8H20a1 1 0 0 1 .96 1.28l-1.5 5.2A2 2 0 0 1 17.54 16H4.5a1.5 1.5 0 0 1-1.5-.5z" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 6A1.5 1.5 0 0 1 5 4.5h3.6a1.5 1.5 0 0 1 1.06.44L11 6.3h6A1.5 1.5 0 0 1 18.5 7.8v8.7A1.5 1.5 0 0 1 17 18H5a1.5 1.5 0 0 1-1.5-1.5z" />
                </svg>
              )}
            </div>
          </>
        ) : (
          <div className="w-4 h-4 mr-1.5 flex items-center justify-center flex-shrink-0">
             <FileIcon fileName={node.name} className="w-4 h-4" />
          </div>
        )}

        {/* File/Folder Name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Trash Icon (Only visible on hover) */}
        <div className="hidden group-hover:flex items-center ml-auto pl-2">
          <button 
            onClick={handleDelete}
            className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
            title="Delete"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>
            </svg>
          </button>
        </div>
      </div>

      {/* Recursive Render for Children */}
      {isDir && isExpanded && node.children && (
        <div>
          {node.children.map(child => (
            <FileExplorerNode
              key={child.path}
              node={child}
              level={level + 1}
              activeFilePath={activeFilePath}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              eventBus={eventBus}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// --- 2. MAIN EXPLORER CONTAINER ---
interface FileExplorerProps {
  workspaceName: string;
  files: FileNode[];
  activeFilePath: string | null;
  eventBus: EditorEventBus; 
}

export const FileExplorer = ({ workspaceName, files, activeFilePath, eventBus }: FileExplorerProps) => {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['/src', '/cogs']));

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-ide-panel py-2 overflow-y-auto custom-scrollbar-hide">
      
      {/* Workspace Header */}
      <div className="flex items-center justify-between px-4 pb-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-ide-muted">
          {workspaceName}
        </span>
        
        <button className="text-ide-muted hover:text-ide-text p-1 rounded hover:bg-ide-hover transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 9.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
          </svg>
        </button>
      </div>

      {/* Render the File Tree */}
      <div className="flex-col">
        {files.length === 0 ? (
          <div className="px-4 text-xs text-ide-muted italic mt-2">No files in workspace</div>
        ) : (
          files.map(node => (
            <FileExplorerNode
              key={node.path}
              node={node}
              level={0}
              activeFilePath={activeFilePath}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              eventBus={eventBus}
            />
          ))
        )}
      </div>
      
    </div>
  );
};