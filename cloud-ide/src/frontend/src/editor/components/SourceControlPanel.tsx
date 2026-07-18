// The "Source Control" sidebar pane: the sandbox worktree's git status, a commit box,
// and push/pull — real git on the host worktree (git-integration.md), reached through
// the owner-gated /v1/sandboxes/:id/git routes. A GitHub PAT (user-scoped) is what makes
// push/pull work against private remotes; public repos need none.
//
// v1 commits EVERYTHING (stage-all then commit): the backend exposes stage + commit but
// no `reset`, so per-file staging with no way to unstage would be a trap. Per-file
// staging + a diff view are follow-ups once the backend grows `reset`/`diff` surfacing.
import React, { useCallback, useEffect, useState } from 'react';
import { VscRefresh, VscCloudUpload, VscCloudDownload, VscGithub, VscClose } from 'react-icons/vsc';
import {
  getGitStatus,
  getGitBranch,
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

export const SourceControlPanel = ({ sandboxId }: SourceControlPanelProps) => {
  const [branch, setBranch] = useState<string | null>(null);
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'commit' | 'push' | 'pull' | 'refresh'>(null);

  const [cred, setCred] = useState<GitCredentialState | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [savingCred, setSavingCred] = useState(false);

  const refresh = useCallback(async () => {
    setBusy('refresh');
    setError(null);
    try {
      const [{ entries }, { branch }] = await Promise.all([getGitStatus(sandboxId), getGitBranch(sandboxId)]);
      setEntries(entries);
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

  const commit = async () => {
    const msg = message.trim();
    if (!msg || entries.length === 0) return;
    setBusy('commit');
    try {
      await gitStage(sandboxId);        // stage all — see file header
      await gitCommit(sandboxId, msg);
      setMessage('');
      toast.success('Changes committed to the workspace branch.', { title: 'Commit' });
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

  const canCommit = !!message.trim() && entries.length > 0 && busy === null;

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
            {busy === 'commit' ? 'Committing…' : `Commit${entries.length ? ` ${entries.length}` : ''}`}
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
        <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ide-muted">
          Changes {entries.length > 0 && `(${entries.length})`}
        </p>
        {!error && entries.length === 0 && (
          <p className="px-2 pb-1 text-[11.5px] italic text-ide-muted">
            No changes — the workspace is clean.
          </p>
        )}
        {entries.map((e) => {
          const d = decorate(e.status);
          return (
            <div
              key={e.path}
              title={`${d.label}: ${e.path}`}
              className="group flex items-center gap-2 rounded px-2 py-1 text-[12.5px] hover:bg-ide-hover"
            >
              <span className={`w-3 flex-shrink-0 text-center font-mono text-[11px] font-bold ${d.tone}`}>
                {d.letter}
              </span>
              <span className="truncate font-mono text-ide-text">{e.path}</span>
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
