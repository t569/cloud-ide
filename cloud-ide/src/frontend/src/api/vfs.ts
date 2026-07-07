// frontend/src/api/vfs.ts
//
// Frontend client for the backend Virtual File System (mounted at /api/fs).
// Endpoints mirror backend/src/api/FileSystemRoutes.ts exactly:
//   GET    /fs/:sandboxId/ls?path=...      -> VfsNode[]
//   GET    /fs/:sandboxId/read?path=...    -> VfsReadResult
//   POST   /fs/:sandboxId/write            -> VfsMutationResult   { path, content }
//   DELETE /fs/:sandboxId/delete?path=...  -> VfsMutationResult
//
// Types come from @cloud-ide/shared, the single source of truth the backend
// also uses — the wire shape cannot drift between tiers or branches.
//
// All calls route through the shared apiClient, which attaches the session
// cookie (credentials: 'include') and a CSRF double-submit token on
// state-changing requests. Do NOT hand-roll fetch() here — that bypasses those
// protections.
import { apiClient } from '../lib/apiClient';
import type { VfsNode, VfsReadResult, VfsMutationResult } from '@cloud-ide/shared';

export type { VfsNode, VfsReadResult, VfsMutationResult };

export const VirtualFileSystem = {
  /** Writes file content to the sandbox filesystem. */
  saveFile: (sandboxId: string, filePath: string, content: string): Promise<VfsMutationResult> =>
    apiClient.post<VfsMutationResult>(`/fs/${sandboxId}/write`, { path: filePath, content }),

  /** Reads raw file content. */
  getFile: (sandboxId: string, filePath: string): Promise<VfsReadResult> => {
    const query = new URLSearchParams({ path: filePath }).toString();
    return apiClient.get<VfsReadResult>(`/fs/${sandboxId}/read?${query}`);
  },

  /** Deletes a file or directory (recursive). */
  deleteEntity: (sandboxId: string, targetPath: string): Promise<VfsMutationResult> => {
    const query = new URLSearchParams({ path: targetPath }).toString();
    return apiClient.delete<VfsMutationResult>(`/fs/${sandboxId}/delete?${query}`);
  },

  /**
   * Lists one directory level for the sidebar explorer.
   * ponytail: flat per-directory listing, not a recursive tree — the sidebar
   * lazy-loads children on expand. Add a /tree endpoint if that ever hurts.
   */
  listDirectory: (sandboxId: string, dirPath: string = '/workspace'): Promise<VfsNode[]> => {
    const query = new URLSearchParams({ path: dirPath }).toString();
    return apiClient.get<VfsNode[]>(`/fs/${sandboxId}/ls?${query}`);
  },
};
