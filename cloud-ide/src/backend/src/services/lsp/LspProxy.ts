// backend/src/services/lsp/LspProxy.ts
//
// Owns one LspSession per (sandbox, language) and turns the frontend's HTTP
// requests into LSP traffic. Everything deployment-specific is INJECTED, so the
// proxy itself is pure protocol glue and unit-testable with a fake stream:
//   - serverFor:     where a language's server listens (null => not configured).
//   - hostPathFor:   workspace path -> absolute host path (the file:// the server sees).
//   - rootHostPath:  the workspace root host path (the LSP rootUri).
//   - readFile:      lazy didOpen source (the hybrid's read-from-worktree).
//   - connect:       stream opener; defaults to TCP, swap for an SSH tunnel later.
//
// ponytail: single-node assumption — the language server shares a disk with the
// gateway, so host paths ARE the server's paths (same as FileSystemManager). For
// a remote server over SSH, hostPathFor/rootHostPath become the remote mapping;
// nothing else here changes.

import { Duplex } from 'node:stream';
import { LspSession, pathToUri, uriToPath } from './LspSession';
import { connectTcp } from './tcpConnector';
import { PORT_TO_LSP, toLspParams, fromLspResult } from './lspMethods';
import { ContentChange } from './textEdit';

export interface LspServerConfig {
  host: string;
  port: number;
}

export interface LspProxyDeps {
  serverFor(languageId: string): LspServerConfig | null;
  hostPathFor(sandboxId: string, workspacePath: string): Promise<string>;
  rootHostPath(sandboxId: string): Promise<string>;
  readFile(sandboxId: string, workspacePath: string): Promise<string>;
  connect?(host: string, port: number): Promise<Duplex>;
}

export class NoLanguageServerError extends Error {}

/** Parse `LSP_SERVERS="python=127.0.0.1:2087;typescript=127.0.0.1:2089"` into a lookup. */
export function parseLspServers(spec: string | undefined): Map<string, LspServerConfig> {
  const map = new Map<string, LspServerConfig>();
  for (const entry of (spec ?? '').split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const m = /^([\w-]+)\s*=\s*([^:]+):(\d+)$/.exec(trimmed);
    if (m) map.set(m[1], { host: m[2], port: Number(m[3]) });
  }
  return map;
}

export class LspProxy {
  private sessions = new Map<string, Promise<LspSession>>();

  constructor(private deps: LspProxyDeps) {}

  isConfigured(languageId: string): boolean {
    return this.deps.serverFor(languageId) !== null;
  }

  /** Number of live (sandbox, language) sessions — a health-page metric. */
  sessionCount(): number {
    return this.sessions.size;
  }

  private key(sandboxId: string, languageId: string): string {
    return `${sandboxId}:${languageId}`;
  }

  private getSession(sandboxId: string, languageId: string): Promise<LspSession> {
    const key = this.key(sandboxId, languageId);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const config = this.deps.serverFor(languageId);
    if (!config) throw new NoLanguageServerError(`No language server configured for '${languageId}'`);

    const connect = this.deps.connect ?? connectTcp;
    const session = (async () => {
      const root = await this.deps.rootHostPath(sandboxId);
      const stream = await connect(config.host, config.port);
      const s = new LspSession(stream, pathToUri(root));
      await s.ready();
      return s;
    })();
    // Don't cache a failed bring-up — let the next request retry a fresh connect.
    session.catch(() => this.sessions.delete(key));
    this.sessions.set(key, session);
    return session;
  }

  /**
   * Absolute host path -> the path the frontend speaks.
   *
   * Inside the worktree that's a `/workspace`-rooted path. OUTSIDE it — a
   * go-to-definition landing in the stdlib or site-packages, which is most of
   * them — the path is returned untouched, and the editor opens it read-only
   * (see VFSController.isExternal).
   *
   * This used to prefix unconditionally, so `/usr/lib/python3.11/os.py` came back
   * as `/workspace/usr/lib/python3.11/os.py`: a path that doesn't exist, pointing
   * at a file we'd then have happily created in the worktree.
   */
  private hostToWorkspace(root: string, hostAbs: string): string {
    // Separator-agnostic: the host is posix in prod, win32 in dev.
    const inRoot =
      hostAbs === root || hostAbs.startsWith(`${root}/`) || hostAbs.startsWith(`${root}\\`);
    if (!inRoot) return hostAbs;
    return `/workspace/${hostAbs.slice(root.length).replace(/^[/\\]+/, '')}`;
  }

  async request(sandboxId: string, languageId: string, method: string, params: any): Promise<unknown> {
    if (!PORT_TO_LSP[method]) throw new Error(`Unsupported LSP method: ${method}`);

    const session = await this.getSession(sandboxId, languageId);
    const hostPath = await this.deps.hostPathFor(sandboxId, params.path);
    await session.ensureOpen(hostPath, languageId, () => this.deps.readFile(sandboxId, params.path));

    const raw = await session.request(PORT_TO_LSP[method], toLspParams(method, { ...params, uri: pathToUri(hostPath) }));

    const root = await this.deps.rootHostPath(sandboxId);
    return fromLspResult(method, raw, (uri) => this.hostToWorkspace(root, uriToPath(uri)));
  }

  /**
   * Frontend didChange — keep the server on the live editor buffer (the hybrid).
   * `changes` are incremental deltas (or a full-replacement snapshot). The doc is
   * lazily opened from the worktree first, so deltas apply onto the right baseline.
   */
  async change(sandboxId: string, languageId: string, workspacePath: string, changes: ContentChange[]): Promise<void> {
    const session = await this.getSession(sandboxId, languageId);
    const hostPath = await this.deps.hostPathFor(sandboxId, workspacePath);
    await session.ensureOpen(hostPath, languageId, () => this.deps.readFile(sandboxId, workspacePath));
    session.change(hostPath, changes);
  }

  /** Subscribe to a session's diagnostics, remapped to workspace paths for the SSE stream. */
  async subscribeDiagnostics(
    sandboxId: string,
    languageId: string,
    cb: (workspacePath: string, diagnostics: any[]) => void,
  ): Promise<() => void> {
    const session = await this.getSession(sandboxId, languageId);
    const root = await this.deps.rootHostPath(sandboxId);
    return session.onDiagnostics((hostAbs, diagnostics) => cb(this.hostToWorkspace(root, hostAbs), diagnostics));
  }

  dispose(): void {
    for (const p of this.sessions.values()) p.then((s) => s.dispose()).catch(() => {});
    this.sessions.clear();
  }
}
