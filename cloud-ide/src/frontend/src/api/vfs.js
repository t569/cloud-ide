// frontend/src/api/vfs.js

/*
* frontend api endpoints for CRUD operations on the virtual file system in the backend
* this file defines all the various endpoints for CRUD operations on a file/directory, mounted on our backend virtaul file system
*
* All calls route through the shared apiClient, which attaches the session cookie
* (credentials: 'include') and a CSRF double-submit token on state-changing
* requests. Do NOT hand-roll fetch() here — that bypasses those protections.
*/
import { apiClient } from "../lib/apiClient";

export const VirtualFileSystem = {
  /** Pushes the file content to the OS physical hard drive. */
  saveFile: (sessionId, filePath, content) =>
    apiClient.put(`/fs/${sessionId}/save`, { path: filePath, content }),

  /** Pulls the raw file content from the OS physical hard drive. */
  getFile: (sessionId, filePath) => {
    const query = new URLSearchParams({ path: filePath }).toString();
    return apiClient.get(`/fs/${sessionId}/file?${query}`); // -> { content: "..." }
  },

  /** Creates a new file and sends it to the backend. */
  createFile: (sessionId, filePath) =>
    apiClient.post(`/fs/${sessionId}/file`, { path: filePath }),

  /** Creates a new directory and sends it to the backend. */
  createDirectory: (sessionId, dirPath) =>
    apiClient.post(`/fs/${sessionId}/directory`, { path: dirPath }),

  /** Rename a particular file or directory. */
  renameEntity: (sessionId, oldPath, newPath) =>
    apiClient.put(`/fs/${sessionId}/rename`, { oldPath, newPath }),

  /** Delete a file or directory. */
  deleteEntity: (sessionId, targetPath) => {
    const query = new URLSearchParams({ path: targetPath }).toString();
    return apiClient.delete(`/fs/${sessionId}/entity?${query}`);
  },

  /** Fetches the nested directory structure for the sidebar explorer. */
  getTree: async (sessionId) => {
    const data = await apiClient.get(`/fs/${sessionId}/tree`);
    return data.tree; // Returns an array of nested file/folder objects
  },
};
