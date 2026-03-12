import React, { useState } from 'react';
import { VscFolder, VscFolderOpened, VscFile } from 'react-icons/vsc';
import { SiJavascript, SiPython, SiHtml5, SiReact } from 'react-icons/si';

// Helper to grab the right icon
const getFileIcon = (name) => {
  if (name.endsWith('.js')) return <SiJavascript color="#f7df1e" />;
  if (name.endsWith('.jsx')) return <SiReact color="#61dafb" />;
  if (name.endsWith('.py')) return <SiPython color="#3776ab" />;
  if (name.endsWith('.html')) return <SiHtml5 color="#e34f26" />;
  return <VscFile color="#cccccc" />;
};

export default function FileExplorer({ files, activeFile, onSelectFile }) {
  return (
    <div style={{ padding: '10px 0', display: 'flex', flexDirection: 'column' }}>
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

// The Recursive Component
function FileNode({ name, node, activeFile, onSelectFile, depth }) {
  const [isOpen, setIsOpen] = useState(node.isOpen || false);
  const isFolder = node.type === 'folder';
  const isActive = activeFile?.name === name && !isFolder;

  const handleToggle = () => {
    if (isFolder) setIsOpen(!isOpen);
    else onSelectFile(node);
  };

  return (
    <div>
      {/* Render the current file/folder */}
      <div 
        onClick={handleToggle}
        style={{
          padding: `4px 15px`,
          paddingLeft: `${15 + depth * 12}px`, // Indent based on depth
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '14px',
          backgroundColor: isActive ? '#37373d' : 'transparent',
          color: isActive ? '#fff' : '#ccc',
          userSelect: 'none'
        }}
      >
        {isFolder ? (
          isOpen ? <VscFolderOpened color="#dcb67a" size={16} /> : <VscFolder color="#dcb67a" size={16} />
        ) : (
          getFileIcon(name)
        )}
        <span>{name}</span>
      </div>

      {/* If it's an open folder, recursively render its children */}
      {isFolder && isOpen && node.children && (
        <div>
          {Object.entries(node.children).map(([childName, childNode]) => (
            <FileNode 
              key={childName}
              name={childName}
              node={childNode}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              depth={depth + 1} // Increase indentation
            />
          ))}
        </div>
      )}
    </div>
  );
}