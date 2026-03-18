// frontend/src/api/vfs.js

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