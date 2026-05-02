// frontend/src/editor/components/FileExplorer.tsx
import React, { useState } from 'react';
import { FileIcon } from '@frontend/common/FileIcon';
import { FileNode, EditorEventPayloads } from '../types/editor';

// --- 1. RECURSIVE NODE COMPONENT ---
interface FileExplorerNodeProps {
  node: FileNode;
  level: number;
  activeFilePath: string | null;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  eventBus: {
    emit: <K extends keyof EditorEventPayloads>(event: K, payload: EditorEventPayloads[K]) => void;
  };
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

  return (
    <div>
      {/* The Actual Item Row */}
      <div 
        onClick={handleClick}
        className={`
          flex items-center group cursor-pointer mx-2 px-2 py-1.5 rounded-md text-[13px] font-sans transition-colors select-none
          ${isActive 
            ? 'bg-[#313338] text-[#dbdee1]' 
            : 'text-[#949ba4] hover:bg-[#2b2d31] hover:text-[#dbdee1]'
          }
        `}
        style={{ paddingLeft: `${(level * 12) + 8}px` }} // Dynamic indentation
      >
        {/* Render Chevron for Directories, or File Icon for Files */}
        {isDir ? (
          <div className="w-4 h-4 mr-1 flex items-center justify-center flex-shrink-0 text-gray-500 group-hover:text-gray-300">
            <svg 
              width="12" height="12" viewBox="0 0 16 16" fill="currentColor"
              className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
            >
              <path fillRule="evenodd" clipRule="evenodd" d="M5.707 3.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L9.086 8 5.707 4.707a1 1 0 010-1.414z" />
            </svg>
          </div>
        ) : (
          <div className="w-4 h-4 mr-1.5 flex items-center justify-center flex-shrink-0">
             <FileIcon fileName={node.name} className="w-4 h-4" />
          </div>
        )}

        {/* File/Folder Name */}
        <span className="truncate">{node.name}</span>
      </div>

      {/* Recursive Render for Children (If Directory is Expanded) */}
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
  eventBus: any; // Type to your EventBus instance
}

export const FileExplorer = ({ workspaceName, files, activeFilePath, eventBus }: FileExplorerProps) => {
  // Local state to track which folders are toggled open
  // In a full implementation, you might want this to implement `ISerializable` for snapshots!
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
    <div className="flex flex-col h-full bg-[#252526] text-[#cccccc] py-2 overflow-y-auto custom-scrollbar-hide">
      
      {/* Workspace Header (Matches "Discord Bot" in your image) */}
      <div className="flex items-center justify-between px-4 pb-2 mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[#cccccc]">
          {workspaceName}
        </span>
        
        {/* Three dots menu from the image */}
        {/* TODO: implement srop down menu for this */}
        <button className="text-gray-500 hover:text-white p-1 rounded hover:bg-[#333333] transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 9.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
          </svg>
        </button>
      </div>

      {/* Render the File Tree */}
      <div className="flex-col">
        {files.length === 0 ? (
          <div className="px-4 text-xs text-gray-500 italic mt-2">No files in workspace</div>
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