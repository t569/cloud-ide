// frontend/src/api/vfs.js

/*
* Frontend client for the backend Virtual File System (mounted at /api/fs).
* Endpoints mirror backend/src/api/FileSystemRoutes.ts exactly:
*   GET    /fs/:sandboxId/ls?path=...      -> flat directory listing
*   GET    /fs/:sandboxId/read?path=...    -> { content }
*   POST   /fs/:sandboxId/write            -> { path, content }
*   DELETE /fs/:sandboxId/delete?path=...
*/
import { API_BASE_URL } from "../config/env";

async function handle(response, fallbackMessage) {
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || fallbackMessage);
  }
  return response.json();
}

export const VirtualFileSystem = {
  /**
   * Pushes the file content to the sandbox filesystem.
   */
  saveFile: async (sandboxId, filePath, content) => {
    const response = await fetch(`${API_BASE_URL}/fs/${sandboxId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content })
    });
    return handle(response, 'Failed to save file to VFS');
  },

  /**
   * Pulls the raw file content. Returns { content: "raw string data..." }.
   */
  getFile: async (sandboxId, filePath) => {
    const query = new URLSearchParams({ path: filePath }).toString();
    const response = await fetch(`${API_BASE_URL}/fs/${sandboxId}/read?${query}`);
    return handle(response, 'Failed to read file from VFS');
  },

  /**
   * Deletes a file or directory (recursive).
   */
  deleteEntity: async (sandboxId, targetPath) => {
    const query = new URLSearchParams({ path: targetPath }).toString();
    const response = await fetch(`${API_BASE_URL}/fs/${sandboxId}/delete?${query}`, {
      method: 'DELETE'
    });
    return handle(response, 'Failed to delete path');
  },

  /**
   * Lists one directory level for the sidebar explorer.
   * Returns [{ name, path, type: 'file' | 'directory' }, ...].
   * ponytail: flat per-directory listing, not a recursive tree — the sidebar
   * lazy-loads children on expand. Add a /tree endpoint if that ever hurts.
   */
  listDirectory: async (sandboxId, dirPath = '/workspace') => {
    const query = new URLSearchParams({ path: dirPath }).toString();
    const response = await fetch(`${API_BASE_URL}/fs/${sandboxId}/ls?${query}`);
    return handle(response, 'Failed to list directory');
  }
};
