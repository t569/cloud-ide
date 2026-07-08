// backend/src/workspace/WorkspaceManager.ts
//
// ⚠️ EMPTY STUB / SUPERSEDED as of 2026-07-08 — this was to be the "chokidar
// daemon", but that job now belongs to services/WorkspaceWatchers.ts (host-worktree
// watch → FsEventHub → SSE). This class has no body and is imported nowhere; it's
// safe to delete. Left in place only because the workspace/ folder is otherwise
// empty — repurpose it if a distinct workspace-orchestration layer is ever needed.
import { EventEmitter } from 'node:events';

export class WorkspaceManager extends EventEmitter { }