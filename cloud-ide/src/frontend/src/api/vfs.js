// frontend/src/api/vfs.js

/*
* Frontend client for the backend Virtual File System (mounted at /api/fs).
* Endpoints mirror backend/src/api/FileSystemRoutes.ts exactly:
*   GET    /fs/:sandboxId/ls?path=...      -> flat directory listing
*   GET    /fs/:sandboxId/read?path=...    -> { content }
*   POST   /fs/:sandboxId/write            -> { path, content }
*   DELETE /fs/:sandboxId/delete?path=...
*
* All calls route through the shared apiClient, which attaches the session cookie
* (credentials: 'include') and a CSRF double-submit token on state-changing
* requests. Do NOT hand-roll fetch() here — that bypasses those protections.
*/
import { apiClient } from "../lib/apiClient";

export const VirtualFileSystem = {
  /** Pushes the file content to the sandbox filesystem. */
  saveFile: (sandboxId, filePath, content) =>
    apiClient.post(`/fs/${sandboxId}/write`, { path: filePath, content }),

  /** Pulls the raw file content. Returns { content: "..." }. */
  getFile: (sandboxId, filePath) => {
    const query = new URLSearchParams({ path: filePath }).toString();
    return apiClient.get(`/fs/${sandboxId}/read?${query}`);
  },

  /** Deletes a file or directory (recursive). */
  deleteEntity: (sandboxId, targetPath) => {
    const query = new URLSearchParams({ path: targetPath }).toString();
    return apiClient.delete(`/fs/${sandboxId}/delete?${query}`);
  },

  /**
   * Lists one directory level for the sidebar explorer.
   * Returns [{ name, path, type: 'file' | 'directory' }, ...].
   * ponytail: flat per-directory listing, not a recursive tree — the sidebar
   * lazy-loads children on expand. Add a /tree endpoint if that ever hurts.
   */
  listDirectory: (sandboxId, dirPath = '/workspace') => {
    const query = new URLSearchParams({ path: dirPath }).toString();
    return apiClient.get(`/fs/${sandboxId}/ls?${query}`);
  },
};
