// A left-docked "commit history" panel, opened from the status-bar branch widget. Reads
// the real worktree log (git-integration.md) via /v1/sandboxes/:id/git/log and renders it
// as a vertical timeline rail — dot + connecting line per commit.
//
// ponytail: linear rail, not a full branch/merge DAG. The log endpoint returns no parent
// hashes, so real graph lanes would need `git log --parents` on the backend + lane layout.
// This shows the current branch's history, which is what the widget points at; add the DAG
// when multi-branch visualization is actually needed.
import React, { useEffect, useState } from 'react';
import { VscClose, VscGitCommit } from 'react-icons/vsc';
import { getGitLog, type GitLogEntry } from '../../api/git';
import { timeAgo } from '../../env-manager/utils/timeAgo';

interface CommitHistoryProps {
  sandboxId: string;
  branch: string | null;
  onClose: () => void;
}

export const CommitHistory = ({ sandboxId, branch, onClose }: CommitHistoryProps) => {
  const [commits, setCommits] = useState<GitLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGitLog(sandboxId, limit)
      .then((r) => { if (!cancelled) { setCommits(r.commits); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sandboxId, limit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Commit history"
        className="fixed left-0 top-0 bottom-6 z-50 flex w-[380px] max-w-[92vw] flex-col border-r border-ide-border bg-ide-panel shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-ide-border px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ide-muted">
            <VscGitCommit size={13} /> History{branch ? ` · ${branch}` : ''}
          </span>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="rounded p-0.5 text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text"
          >
            <VscClose size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {error && <p className="text-[12px] text-red-400">{error}</p>}
          {!error && commits === null && <p className="text-[12px] italic text-ide-muted">Loading…</p>}
          {!error && commits?.length === 0 && (
            <p className="text-[12px] italic text-ide-muted">No commits yet on this branch.</p>
          )}

          {commits && commits.length > 0 && (
            <ol className="relative ml-1 border-l border-ide-border">
              {commits.map((c) => (
                <li key={c.hash} className="relative py-2 pl-4">
                  <span className="absolute -left-[5px] top-[13px] h-2 w-2 rounded-full bg-ide-accent ring-2 ring-ide-panel" />
                  <p className="break-words text-[12.5px] leading-snug text-ide-text">{c.subject}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ide-muted">
                    <span className="font-mono text-ide-accent">{c.hash.slice(0, 7)}</span>
                    <span className="truncate">{c.author}</span>
                    <span title={c.date}>{timeAgo(Date.parse(c.date))}</span>
                  </p>
                </li>
              ))}
            </ol>
          )}

          {commits && commits.length >= limit && (
            <button
              onClick={() => setLimit((l) => l + 50)}
              disabled={loading}
              className="mt-2 w-full rounded border border-ide-border py-1 text-[11.5px] text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      </div>
    </>
  );
};
