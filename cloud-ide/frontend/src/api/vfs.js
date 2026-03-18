// frontend/src/api/vfs.js

/*
* frontend api endpoints for CRUD operations on the virtual file system in the backend
* this file defines all the various endpoints for CRUD operations on a file/directory, mounted on our backend virtaul file system
*/


export const VirtualFileSystem = {
  /**
   * Pushes the file content to the OS physical hard drive.
   */
  saveFile: async (sessionId, filePath, content) => {
    const response = await fetch(`/api/fs/${sessionId}/save`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to save file to VFS');
    }

    return response.json();
  },

  /**
   * Pulls the raw file content from the OS physical hard drive.
   */
  getFile: async (sessionId, filePath) => {
    // Safely encode the path as a query parameter
    const query = new URLSearchParams({ path: filePath }).toString();
    
    const response = await fetch(`/api/fs/${sessionId}/file?${query}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to read file from VFS');
    }

    return response.json(); // Returns { content: "raw string data..." }
  },

  /**
   * Creates a new file and sends it to the backend
   * @param {*} sessionId 
   * @param {*} filePath 
   * @returns 
   */
  createFile: async (sessionId, filePath) => {
    const response = await fetch(`/api/fs/${sessionId}/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    return response.json();
  },

  /**
   * Creates a new directory and sends it to the backend
   * @param {*} sessionId 
   * @param {*} dirPath 
   * @returns 
   */
  createDirectory: async (sessionId, dirPath) => {
    const response = await fetch(`/api/fs/${sessionId}/directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dirPath })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    return response.json();
  },

  /**
   * Rename a particular file or directory
   * @param {*} sessionId 
   * @param {*} oldPath 
   * @param {*} newPath 
   * @returns 
   */
  renameEntity: async (sessionId, oldPath, newPath) => {
    const response = await fetch(`/api/fs/${sessionId}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    return response.json();
  },

  /**
   * Delete a file or directory
   * @param {*} sessionId 
   * @param {*} targetPath 
   * @returns 
   */
  deleteEntity: async (sessionId, targetPath) => {
    const query = new URLSearchParams({ path: targetPath }).toString();
    const response = await fetch(`/api/fs/${sessionId}/entity?${query}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error((await response.json()).error);
    return response.json();
  },


  /**
   * Fetches the nested directory structure for the sidebar explorer.
   */
  getTree: async (sessionId) => {
    const response = await fetch(`/api/fs/${sessionId}/tree`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch directory tree');
    }

    const data = await response.json();
    return data.tree; // Returns an array of nested file/folder objects
  }
};