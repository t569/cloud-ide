// @cloud-ide/shared/types/vfs.ts
//
// The canonical Virtual File System API contract, shared by the backend
// (FileSystemManager / FileSystemRoutes) and the frontend client (api/vfs.ts).
// One definition so the wire shape can never drift between the two tiers — or
// between branches that touch the VFS.

/** A single entry in a directory listing — GET /api/fs/:sandboxId/ls */
export interface VfsNode {
  name: string;
  path: string;                 // container-visible path, e.g. /workspace/src/index.js
  type: 'file' | 'directory';
}

/** GET /api/fs/:sandboxId/read */
export interface VfsReadResult {
  content: string;
}

/** POST /api/fs/:sandboxId/write and DELETE /api/fs/:sandboxId/delete */
export interface VfsMutationResult {
  message: string;
}
