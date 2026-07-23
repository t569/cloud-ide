// The "Source Control" sidebar pane: the sandbox worktree's git status, a commit box,
// and push/pull — real git on the host worktree (git-integration.md), reached through
// the owner-gated /v1/sandboxes/:id/git routes. A GitHub PAT (user-scoped) is what makes
// push/pull work against private remotes; public repos need none.
//
// Files are ticked individually and the commit is scoped with `-- <paths>`, which
// disregards the index — so an unticked file can never ride along and there is nothing
// to unstage. That is why this needs no `reset` endpoint. Clicking a file expands its
// diff vs HEAD (staged + unstaged: what the commit would actually capture).
import React, { useCallback, useEffect, useState } from 'react';
import {
  VscRefresh, VscCloudUpload, VscCloudDownload, VscGithub, VscClose,
  VscChevronRight, VscChevronDown, VscGoToFile,
} from 'react-icons/vsc';
import {
  getGitStatus,
  getGitBranch,
  getGitDiff,
  gitStage,
  gitCommit,
  gitPush,
  gitPull,
  getGitCredential,
  setGitCredential,
  clearGitCredential,
  type GitStatusEntry,
  type GitCredentialState,
} from '../../api/git';
import { EditorEventBus } from '../core/EditorEventBus';
import { toast } from '../../notifications';

interface SourceControlPanelProps {
  sandboxId: string;
  eventBus: EditorEventBus;
}

/** git status paths are worktree-relative; the VFS keys off the container mount. */
const WORKSPACE_ROOT = '/workspace';

/** Colour one unified-diff line. `+++`/`---` are headers, not additions/removals. */
function diffTone(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'text-emerald-400';
  if (line.startsWith('-') && !line.startsWith('---')) return 'text-red-400';
  if (line.startsWith('@@')) return 'text-sky-400';
  return 'text-ide-muted';
}

/** Human label + colour for a porcelain XY code's leading char. */
function decorate(status: string): { letter: string; label: string; tone: string } {
  const x = status.trim()[0] ?? '?';
  switch (x) {
    case 'M': return { letter: 'M', label: 'Modified', tone: 'text-amber-400' };
    case 'A': return { letter: 'A', label: 'Added', tone: 'text-emerald-400' };
    case 'D': return { letter: 'D', label: 'Deleted', tone: 'text-red-400' };
    case 'R': return { letter: 'R', label: 'Renamed', tone: 'text-sky-400' };
    case '?': return { letter: 'U', label: 'Untracked', tone: 'text-ide-muted' };
    default:  return { letter: x, label: 'Changed', tone: 'text-ide-muted' };
  }
}

export const SourceControlPanel = ({ sandboxId, eventBus }: SourceControlPanelProps) => {
  const [branch, setBranch] = useState<string | null>(null);
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'commit' | 'push' | 'pull' | 'refresh'>(null);

  /** Paths ticked for the next commit. Everything is ticked by default (the common case
   *  is "commit it all"); a refresh re-ticks, so the list never disagrees with status. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The one expanded file and its diff — null diff means "still loading". */
  const [open, setOpen] = useState<{ path: string; diff: string | null } | null>(null);

  const [cred, setCred] = useState<GitCredentialState | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [savingCred, setSavingCred] = useState(false);

  const refresh = useCallback(async () => {
    setBusy('refresh');
    setError(null);
    try {
      const [{ entries }, { branch }] = await Promise.all([getGitStatus(sandboxId), getGitBranch(sandboxId)]);
      setEntries(entries);
      setSelected(new Set(entries.map((e) => e.path)));
      setOpen(null); // a stale diff outlives the file it described
      setBranch(branch);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [sandboxId]);

  useEffect(() => {
    refresh();
    getGitCredential().then(setCred).catch(() => setCred(null));
  }, [refresh]);

  const toggleSelect = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  /** Expand a file's diff (or collapse it if it's the one already open). */
  const toggleDiff = async (entry: GitStatusEntry) => {
    if (open?.path === entry.path) {
      setOpen(null);
      return;
    }
    // An untracked file isn't in HEAD, so it has no diff to fetch — the body offers to
    // open it in the editor instead.
    if (entry.status.startsWith('??')) {
      setOpen({ path: entry.path, diff: '' });
      return;
    }
    setOpen({ path: entry.path, diff: null });
    try {
      const { diff } = await getGitDiff(sandboxId, entry.path);
      // Ignore a response for a file the user has since collapsed or switched away from.
      setOpen((cur) => (cur?.path === entry.path ? { path: entry.path, diff } : cur));
    } catch (e) {
      setOpen((cur) => (cur?.path === entry.path ? null : cur));
      toast.error((e as Error).message, { title: 'Could not load diff' });
    }
  };

  const openInEditor = (path: string) =>
    eventBus.emit('FILE_OPEN_REQUESTED', { path: `${WORKSPACE_ROOT}/${path}` });

  const commit = async () => {
    const msg = message.trim();
    const paths = entries.filter((e) => selected.has(e.path)).map((e) => e.path);
    if (!msg || paths.length === 0) return;
    setBusy('commit');
    try {
      await gitStage(sandboxId, paths);                   // untracked files must be added to be committable
      await gitCommit(sandboxId, msg, undefined, paths);  // `-- paths`: nothing unticked rides along
      setMessage('');
      toast.success(`Committed ${paths.length} file${paths.length === 1 ? '' : 's'} to the workspace branch.`, { title: 'Commit' });
      await refresh();
    } catch (e) {
      toast.error((e as Error).message, { title: 'Commit failed' });
    } finally {
      setBusy(null);
    }
  };

  const run = (kind: 'push' | 'pull', fn: () => Promise<unknown>, verb: string) => async () => {
    setBusy(kind);
    try {
      await fn();
      toast.success(`${verb} complete.`, { title: verb });
      if (kind === 'pull') await refresh();
    } catch (e) {
      toast.error((e as Error).message, { title: `${verb} failed` });
    } finally {
      setBusy(null);
    }
  };

  const saveCred = async () => {
    const token = tokenDraft.trim();
    if (!token) return;
    setSavingCred(true);
    try {
      await setGitCredential(token);
      setTokenDraft('');
      setCred(await getGitCredential());
      toast.success('GitHub token saved — push/pull can now reach private repos.', { title: 'Connected' });
    } catch (e) {
      toast.error((e as Error).message, { title: 'Could not save token' });
    } finally {
      setSavingCred(false);
    }
  };

  const disconnect = async () => {
    try {
      await clearGitCredential();
      setCred({ configured: false, host: null });
      toast.success('GitHub token removed.', { title: 'Disconnected' });
    } catch (e) {
      toast.error((e as Error).message, { title: 'Could not remove token' });
    }
  };

  const canCommit = !!message.trim() && selected.size > 0 && busy === null;
  const allSelected = entries.length > 0 && selected.size === entries.length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ide-border px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ide-muted">
          Source Control
        </span>
        <div className="flex items-center gap-2">
          {branch && (
            <span
              title="Current branch"
              className="max-w-[120px] truncate rounded bg-ide-accent/15 px-1.5 py-0.5 font-mono text-[10px] text-ide-accent"
            >
              {branch}
            </span>
          )}
          <button
            aria-label="Refresh"
            onClick={refresh}
            disabled={busy !== null}
            className="rounded p-0.5 text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
          >
            <VscRefresh size={13} className={busy === 'refresh' ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Commit box + sync actions */}
      <div className="border-b border-ide-border p-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canCommit) commit();
          }}
          placeholder="Commit message (⌘/Ctrl+Enter to commit)"
          rows={2}
          className="w-full resize-none rounded border border-ide-border bg-ide-bg px-2 py-1.5 text-[12px] text-ide-text outline-none placeholder:text-ide-muted focus:border-ide-accent"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={commit}
            disabled={!canCommit}
            className="flex-1 rounded bg-ide-accent px-2.5 py-1 text-[11.5px] font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-40"
          >
            {busy === 'commit' ? 'Committing…' : `Commit${selected.size ? ` ${selected.size}` : ''}`}
          </button>
          <button
            onClick={run('push', () => gitPush(sandboxId), 'Push')}
            disabled={busy !== null}
            title="Push the current branch to origin"
            className="rounded border border-ide-border px-2 py-1 text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
          >
            <VscCloudUpload size={14} />
          </button>
          <button
            onClick={run('pull', () => gitPull(sandboxId), 'Pull')}
            disabled={busy !== null}
            title="Pull from origin (fast-forward)"
            className="rounded border border-ide-border px-2 py-1 text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
          >
            <VscCloudDownload size={14} />
          </button>
        </div>
      </div>

      {/* Changes */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {error && <p className="px-2 text-[12px] text-red-400">{error}</p>}
        <div className="flex items-center justify-between px-2 pb-1">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-ide-muted">
            Changes {entries.length > 0 && `(${selected.size}/${entries.length})`}
          </p>
          {entries.length > 1 && (
            <button
              onClick={() => setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.path)))}
              className="text-[10.5px] uppercase tracking-wider text-ide-muted transition-colors hover:text-ide-text"
            >
              {allSelected ? 'None' : 'All'}
            </button>
          )}
        </div>
        {!error && entries.length === 0 && (
          <p className="px-2 pb-1 text-[11.5px] italic text-ide-muted">
            No changes — the workspace is clean.
          </p>
        )}
        {entries.map((e) => {
          const d = decorate(e.status);
          const expanded = open?.path === e.path;
          const untracked = e.status.startsWith('??');
          return (
            <div key={e.path}>
              <div className="group flex items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-ide-hover">
                <input
                  type="checkbox"
                  checked={selected.has(e.path)}
                  onChange={() => toggleSelect(e.path)}
                  aria-label={`Include ${e.path} in the commit`}
                  className="h-3 w-3 flex-shrink-0 cursor-pointer accent-ide-accent"
                />
                <button
                  onClick={() => toggleDiff(e)}
                  title={`${d.label}: ${e.path}`}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {expanded
                    ? <VscChevronDown size={11} className="flex-shrink-0 text-ide-muted" />
                    : <VscChevronRight size={11} className="flex-shrink-0 text-ide-muted" />}
                  <span className={`w-3 flex-shrink-0 text-center font-mono text-[11px] font-bold ${d.tone}`}>
                    {d.letter}
                  </span>
                  <span className="truncate font-mono text-ide-text">{e.path}</span>
                </button>
              </div>

              {expanded && (
                <div className="mb-1 ml-6 mr-1 overflow-hidden rounded border border-ide-border bg-ide-bg">
                  <div className="flex items-center justify-between border-b border-ide-border px-2 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ide-muted">
                      {untracked ? 'New file' : 'Diff vs HEAD'}
                    </span>
                    <button
                      onClick={() => openInEditor(e.path)}
                      className="flex items-center gap-1 text-[10.5px] text-ide-muted transition-colors hover:text-ide-text"
                    >
                      <VscGoToFile size={11} /> Open
                    </button>
                  </div>
                  <div className="max-h-64 overflow-auto px-2 py-1 font-mono text-[11px] leading-[1.45]">
                    {open.diff === null ? (
                      <span className="text-ide-muted">Loading…</span>
                    ) : untracked ? (
                      <span className="text-ide-muted">Untracked — open it to see the contents.</span>
                    ) : open.diff.trim() === '' ? (
                      <span className="text-ide-muted">No textual change (mode or metadata only).</span>
                    ) : (
                      open.diff.split('\n').map((line, i) => (
                        <div key={i} className={`whitespace-pre ${diffTone(line)}`}>{line || ' '}</div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* GitHub connection */}
      <div className="border-t border-ide-border p-2">
        {cred?.configured ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11.5px] text-ide-text">
              <VscGithub size={14} className="text-ide-muted" />
              Connected to {cred.host ?? 'github.com'}
            </span>
            <button
              onClick={disconnect}
              aria-label="Disconnect GitHub"
              className="rounded p-0.5 text-ide-muted transition-colors hover:bg-ide-border hover:text-ide-text"
            >
              <VscClose size={13} />
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveCred()}
                placeholder="GitHub personal access token"
                disabled={savingCred}
                className="min-w-0 flex-1 rounded border border-ide-border bg-ide-bg px-2 py-1 text-[12px] text-ide-text outline-none placeholder:text-ide-muted focus:border-ide-accent"
              />
              <button
                onClick={saveCred}
                disabled={savingCred || !tokenDraft.trim()}
                className="flex items-center gap-1 rounded border border-ide-border px-2 text-[11.5px] text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
              >
                <VscGithub size={13} /> Connect
              </button>
            </div>
            <p className="pt-1.5 text-[10.5px] leading-snug text-ide-muted">
              Needed for private repos and pushing. Stored encrypted; never leaves the server.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
