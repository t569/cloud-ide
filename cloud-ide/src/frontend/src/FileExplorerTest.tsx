import React, { useState } from 'react';
import { VscFolder, VscFolderOpened } from 'react-icons/vsc';
import { FileIcon } from '@frontend/common/FileIcon'; // Or wherever your icon engine is

// 1. Define the shape of a single file/folder node from your GitHub tree
export interface FileNodeData {
  name: string;
  type: 'file' | 'folder';
  path?: string;
  url?: string;
  sha?: string;
  content?: string | null;
  isOpen?: boolean;
  children?: Record<string, FileNodeData>;
}

// 2. Define the props for the main FileExplorer component
interface FileExplorerProps {
  files: Record<string, FileNodeData>;
  activeFile: FileNodeData | null;
  onSelectFile: (node: FileNodeData) => void; // 🚨 This fixes the ts(7031) error!
}

export default function FileExplorer({ files, activeFile, onSelectFile }: FileExplorerProps) {
  return (
    <div className="py-2 flex flex-col font-sans">
      {Object.entries(files).map(([name, node]) => (
        <FileNode 
          key={name} 
          name={name} 
          node={node} 
          activeFile={activeFile} 
          onSelectFile={onSelectFile} 
          depth={0} 
        />
      ))}
    </div>
  );
}

// 3. Define the props for the recursive FileNode component
interface FileNodeProps {
  name: string;
  node: FileNodeData;
  activeFile: FileNodeData | null;
  onSelectFile: (node: FileNodeData) => void;
  depth: number;
}

// Apply the types to the recursive component
function FileNode({ name, node, activeFile, onSelectFile, depth }: FileNodeProps) {
  const [isOpen, setIsOpen] = useState(node.isOpen || false);
  const isFolder = node.type === 'folder';
  const isActive = activeFile?.path === node.path && !isFolder;

  const handleToggle = () => {
    if (isFolder) setIsOpen(!isOpen);
    else onSelectFile(node);
  };

  return (
    <div>
      <div 
        onClick={handleToggle}
        style={{ paddingLeft: `${16 + depth * 16}px` }} 
        className={`flex items-center gap-2 py-1.5 pr-4 cursor-pointer text-sm select-none transition-colors ${
          isActive 
            ? 'bg-[#37373d] text-white' 
            : 'text-[#cccccc] hover:bg-[#2a2d2e]'
        }`}
      >
        {isFolder ? (
          isOpen ? <VscFolderOpened color="#dcb67a" size={16} className="min-w-[16px]" /> : <VscFolder color="#dcb67a" size={16} className="min-w-[16px]" />
        ) : (
          <FileIcon fileName={name} size={16} /> 
        )}
        <span className="truncate font-jetbrains">{name}</span>
      </div>

      {isFolder && isOpen && node.children && (
        <div>
          {Object.entries(node.children).map(([childName, childNode]) => (
            <FileNode 
              key={childName}
              name={childName}
              node={childNode}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              depth={depth + 1} 
            />
          ))}
        </div>
      )}
    </div>
  );
}