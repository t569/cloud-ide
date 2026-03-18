// frontend/src/pages/IDEWorkspace.jsx

/*
* This file defines the page that renders our WorkspaceEditor component, (TODO) terminal component and sidebar component
*/
import React, { useState } from 'react';
import { VirtualFileSystem } from '../api/vfs';
import WorkspaceEditor from '../components/WorkspaceEditor';

// TODO: implement this
// import FileExplorerSidebar from '../components/FileExplorerSidebar'; 

export default function IDEWorkspace({ sessionId }) {
  // This holds the file currently open in Monaco
  const [activeFile, setActiveFile] = useState(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  /**
   * The Event Handler: Triggered when a user clicks a file in the sidebar tree
   */
  const handleFileClick = async (nodePath, nodeName) => {
    try {
      setIsLoadingFile(true);
      
      // 1. Fetch the raw string from the backend VFS
      const { content } = await VirtualFileSystem.getFile(sessionId, nodePath);
      
      // 2. Set the active file state to pass down to Monaco
      setActiveFile({
        name: nodeName,
        path: nodePath,
        content: content,
        isDirty: false // Freshly loaded, no unsaved changes yet
      });

    } catch (error) {
      console.error(`[VFS Error] Could not load ${nodeName}:`, error.message);
      // TODO: Show an error toast to the user
    } finally {
      setIsLoadingFile(false);
    }
  };

  /**
   * Keeps the parent state synced if Monaco edits or saves the file
   */
  const handleFileStateChange = (filePath, updates) => {
    if (activeFile && activeFile.path === filePath) {
      setActiveFile(prev => ({ ...prev, ...updates }));
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: '#1e1e1e' }}>
      
      {/* LEFT: The File System Explorer */}
      <div style={{ width: '250px', borderRight: '1px solid #333' }}>
        {/* TODO: Imagine your sidebar component here. 
          When a file is clicked, it calls handleFileClick(file.path, file.name)
        */}
      </div>

      {/* RIGHT: The Monaco Editor Wrapper */}
      <div style={{ flex: 1, position: 'relative' }}>
        {isLoadingFile && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', color: '#fff' }}>
            Loading file from OS...
          </div>
        )}
        
        {!isLoadingFile && (
          <WorkspaceEditor 
            sessionId={sessionId}
            file={activeFile}
            onFileStateChange={handleFileStateChange}
          />
        )}
      </div>

    </div>
  );
}