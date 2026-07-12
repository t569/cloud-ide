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

/**
 * Where a language's server lives. Two kinds, and the difference is which
 * filesystem the server can see:
 *
 * - `tcp`  — a server beside the gateway. It shares the gateway's disk, so it sees
 *            the worktree at its HOST path but knows nothing of the sandbox image:
 *            no venv, no node_modules, no cargo registry. Fine for a single global
 *            server; imports from installed packages won't resolve.
 * - `exec` — a server INSIDE the sandbox, over raw stdio. It sees the container's
 *            filesystem, so it resolves the sandbox's own toolchain and deps, and
 *            its paths are already the /workspace paths the frontend speaks.
 */
export type LspServerConfig =
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'exec'; command: string[] };

export interface LspProxyDeps {
  serverFor(languageId: string): LspServerConfig | null;
  hostPathFor(sandboxId: string, workspacePath: string): Promise<string>;
  rootHostPath(sandboxId: string): Promise<string>;
  readFile(sandboxId: string, workspacePath: string): Promise<string>;
  /** TCP transport (default: a net.Socket). */
  connect?(host: string, port: number): Promise<Duplex>;
  /** In-container transport. Absent ⇒ `exec` servers are unavailable (offline). */
  openExecStream?(sandboxId: string, command: string[]): Promise<Duplex>;
}

/**
 * Translates paths between the frontend's /workspace view and whatever the server
 * sees. This is the ONLY thing that differs between a gateway-side server and an
 * in-container one, which is why the protocol engine below needs no knowledge of
 * either.
 */
interface PathMapper {
  toServer(workspacePath: string): Promise<string>;
  fromServer(serverPath: string): string;
}

interface Session {
  lsp: LspSession;
  paths: PathMapper;
}

export class NoLanguageServerError extends Error {}

/**
 * Parse LSP_SERVERS. Semicolon-separated, one entry per language:
 *
 *   python=exec:pyright-langserver --stdio     <- runs INSIDE the sandbox (preferred)
 *   rust=exec:rust-analyzer
 *   typescript=127.0.0.1:2089                  <- a server beside the gateway
 *
 * `exec:` takes the argv to run in the container; everything after it is split on
 * whitespace. Anything else is host:port. Malformed entries are skipped, which
 * leaves that language simply offline rather than failing the boot.
 */
export function parseLspServers(spec: string | undefined): Map<string, LspServerConfig> {
  const map = new Map<string, LspServerConfig>();
  for (const entry of (spec ?? '').split(';')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const exec = /^([\w-]+)\s*=\s*exec:\s*(.+)$/.exec(trimmed);
    if (exec) {
      const command = exec[2].trim().split(/\s+/).filter(Boolean);
      if (command.length) map.set(exec[1], { kind: 'exec', command });
      continue;
    }

    const tcp = /^([\w-]+)\s*=\s*([^:]+):(\d+)$/.exec(trimmed);
    if (tcp) map.set(tcp[1], { kind: 'tcp', host: tcp[2], port: Number(tcp[3]) });
  }
  return map;
}

export class LspProxy {
  private sessions = new Map<string, Promise<Session>>();

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

  private getSession(sandboxId: string, languageId: string): Promise<Session> {
    const key = this.key(sandboxId, languageId);
    const existing = this.sessions.get(key);
    if (existing) return existing;

    const config = this.deps.serverFor(languageId);
    if (!config) throw new NoLanguageServerError(`No language server configured for '${languageId}'`);

    const session = (async () => {
      const { stream, paths, root } = await this.open(sandboxId, config);
      // The stream dies with the server (crash) or the container (destroy/pause).
      // Drop the cache entry so the NEXT request opens a fresh one, instead of
      // every future request failing against a corpse.
      stream.once('close', () => this.sessions.delete(key));

      const lsp = new LspSession(stream, pathToUri(root));
      await lsp.ready();
      return { lsp, paths };
    })();
    // Don't cache a failed bring-up — let the next request retry a fresh connect.
    session.catch(() => this.sessions.delete(key));
    this.sessions.set(key, session);
    return session;
  }

  /**
   * Open the transport and decide how paths translate over it. The root is resolved
   * ONCE here rather than per request (it used to be an await on every single call).
   */
  private async open(
    sandboxId: string,
    config: LspServerConfig,
  ): Promise<{ stream: Duplex; paths: PathMapper; root: string }> {
    if (config.kind === 'exec') {
      if (!this.deps.openExecStream) {
        throw new NoLanguageServerError(
          `Language '${config.command[0]}' is configured to run in-sandbox, but the active driver has no exec stream.`,
        );
      }
      const stream = await this.deps.openExecStream(sandboxId, config.command);
      // The server IS in the container, so it already speaks /workspace paths —
      // no mapping at all, in either direction. Paths it reports outside /workspace
      // (the stdlib, site-packages) are real container paths, which is exactly what
      // the editor's read-only external opener asks the container for.
      const identity: PathMapper = { toServer: async (p) => p, fromServer: (p) => p };
      return { stream, paths: identity, root: '/workspace' };
    }

    const connect = this.deps.connect ?? connectTcp;
    const stream = await connect(config.host, config.port);
    const root = await this.deps.rootHostPath(sandboxId);
    const paths: PathMapper = {
      toServer: (p) => this.deps.hostPathFor(sandboxId, p),
      fromServer: (hostAbs) => this.hostToWorkspace(root, hostAbs),
    };
    return { stream, paths, root };
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

    const { lsp, paths } = await this.getSession(sandboxId, languageId);
    const serverPath = await paths.toServer(params.path);
    await lsp.ensureOpen(serverPath, languageId, () => this.deps.readFile(sandboxId, params.path));

    const raw = await lsp.request(PORT_TO_LSP[method], toLspParams(method, { ...params, uri: pathToUri(serverPath) }));

    return fromLspResult(method, raw, (uri) => paths.fromServer(uriToPath(uri)));
  }

  /**
   * Frontend didChange — keep the server on the live editor buffer (the hybrid).
   * `changes` are incremental deltas (or a full-replacement snapshot). The doc is
   * lazily opened from the worktree first, so deltas apply onto the right baseline.
   */
  async change(sandboxId: string, languageId: string, workspacePath: string, changes: ContentChange[]): Promise<void> {
    const { lsp, paths } = await this.getSession(sandboxId, languageId);
    const serverPath = await paths.toServer(workspacePath);
    await lsp.ensureOpen(serverPath, languageId, () => this.deps.readFile(sandboxId, workspacePath));
    lsp.change(serverPath, changes);
  }

  /** Subscribe to a session's diagnostics, remapped to workspace paths for the SSE stream. */
  async subscribeDiagnostics(
    sandboxId: string,
    languageId: string,
    cb: (workspacePath: string, diagnostics: any[]) => void,
  ): Promise<() => void> {
    const { lsp, paths } = await this.getSession(sandboxId, languageId);
    return lsp.onDiagnostics((serverPath, diagnostics) => cb(paths.fromServer(serverPath), diagnostics));
  }

  dispose(): void {
    for (const p of this.sessions.values()) p.then(({ lsp }) => lsp.dispose()).catch(() => {});
    this.sessions.clear();
  }
}
