// The /sandboxes page (Step 12b). Lists the sandboxes this user owns; clicking one
// opens a detail drawer (Overview) to inspect it, open the workspace, pause/resume,
// or delete it. Opening still routes through the shared launch flow, so a PAUSED
// sandbox is resumed by POST /v1/sessions rather than by anything special here.
import React, { useEffect, useRef, useState } from 'react';
import { VscPulse, VscRefresh, VscServerProcess, VscRocket, VscClose, VscDebugPause, VscPlay, VscTrash, VscRootFolderOpened, VscCloudUpload, VscRepoClone } from 'react-icons/vsc';
import {
  listSandboxes,
  deleteSandbox,
  pauseSandbox,
  resumeSandbox,
  listSandboxSessions,
  streamSandboxLogs,
  listSandboxActivity,
  type SandboxSummary,
  type SessionSummary,
  type ActivitySummary,
} from '../api/sandbox';
import type { SandboxState } from '@cloud-ide/shared/types/sandbox';
import { timeAgo } from '../env-manager/utils/timeAgo';
import { getEnvironment, type SavedEnvironment } from '../env-manager/services/api/environmentApi';
import { openWorkspace } from './launch';
import { navigate } from './router';
import { ApiError } from '../lib/apiClient';
import { PromoteSandbox } from './PromoteSandbox';
import { CloneRepoDialog } from './CloneRepoDialog';

// Matches the env-manager's badge palette: emerald live, amber transitional, red dead.
const STATE_STYLE: Record<SandboxState, { color: string; label: string }> = {
  RUNNING: { color: '#34d399', label: 'Live' },
  PROVISIONING: { color: '#fbbf24', label: 'Starting' },
  PAUSED: { color: '#fbbf24', label: 'Paused' },
  STOPPED: { color: '#f87171', label: 'Stopped' },
  ERROR: { color: '#f87171', label: 'Error' },
};

const StatusPill = ({ state }: { state: SandboxState }) => {
  const { color, label } = STATE_STYLE[state];
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
    </span>
  );
};

export default function Sandboxes() {
  const [sandboxes, setSandboxes] = useState<SandboxSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SandboxSummary | null>(null);
  const [cloning, setCloning] = useState(false);

  // `followId` re-points the drawer at a sandbox whose id CHANGED under it: recovering a
  // dead container boots a replacement onto the same workspace, which mints a new id.
  // Without this the drawer would close on the user mid-action, as if it had vanished.
  const refresh = (followId?: string) => {
    setLoading(true);
    listSandboxes()
      .then((list) => {
        setSandboxes(list);
        setError(null);
        // Keep the drawer's data fresh (or close it if the sandbox is really gone).
        setSelected((cur) => {
          const id = followId ?? cur?.sandboxId;
          return id ? list.find((s) => s.sandboxId === id) ?? null : null;
        });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-gray-200 p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <VscServerProcess /> Sandboxes
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Compute you own — each a container you can attach sessions to, inspect, and tear down.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCloning(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[#5ec8d8]/40 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8]"
          >
            <VscRepoClone /> Clone repo
          </button>
          <button
            onClick={() => refresh()} // not `onClick={refresh}` — that hands it a MouseEvent as followId
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600"
          >
            <VscRefresh className={isLoading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => navigate('/environments')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600"
          >
            <VscRocket /> Environments
          </button>
          <button
            onClick={() => navigate('/health')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600"
          >
            <VscPulse /> Health
          </button>
        </div>
      </header>

      {error && <p className="text-sm text-[#f87171]">Could not load sandboxes: {error}</p>}

      {!error && !isLoading && sandboxes.length === 0 && (
        <p className="text-sm text-gray-500">
          No sandboxes yet.{' '}
          <button onClick={() => navigate('/environments')} className="text-gray-300 underline">
            Launch an environment
          </button>{' '}
          to create one.
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {sandboxes.map((sbx) => (
          <button
            key={sbx.sandboxId}
            onClick={() => setSelected(sbx)}
            aria-current={selected?.sandboxId === sbx.sandboxId}
            className="text-left p-4 rounded-lg border border-gray-800 bg-[#141417] hover:border-gray-600 aria-[current=true]:border-[#5ec8d8]/50"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium truncate">{sbx.environmentId}</span>
              <StatusPill state={sbx.state} />
            </div>
            <p className="text-[11px] text-gray-500 font-mono truncate">{sbx.sandboxId}</p>
            <p className="text-[11px] text-gray-600 mt-2">Active {timeAgo(sbx.lastActiveAt)}</p>
          </button>
        ))}
      </div>

      {selected && (
        <SandboxDrawer sbx={selected} onClose={() => setSelected(null)} onChanged={refresh} />
      )}

      {cloning && <CloneRepoDialog onClose={() => setCloning(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer (Overview). Settings and Logs tabs land in later slices — no
// empty scaffolding until they carry real content.
// ---------------------------------------------------------------------------
function SandboxDrawer({
  sbx,
  onClose,
  onChanged,
}: {
  sbx: SandboxSummary;
  onClose: () => void;
  /** `followId` keeps the drawer on the sandbox when an action changed its id. */
  onChanged: (followId?: string) => void;
}) {
  const [busy, setBusy] = useState<null | string>(null);
  const [confirming, setConfirming] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // Set when a clean delete is rejected (409) because the worktree is dirty —
  // flips the confirm panel into offering a force-delete.
  const [forceNeeded, setForceNeeded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<'ov' | 'set' | 'log'>('ov');
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  // null = loading, 'none' = no linked environment (raw sandbox), else the config.
  const [env, setEnv] = useState<SavedEnvironment | null | 'none'>(null);

  // Load session history + linked environment whenever the drawer targets a new
  // sandbox. Reset the tab so a fresh sandbox opens on Overview.
  useEffect(() => {
    let live = true;
    setTab('ov');
    setSessions(null);
    setEnv(null);
    setConfirming(false);
    setForceNeeded(false);
    setPromoting(false);
    setActionError(null);
    listSandboxSessions(sbx.sandboxId)
      .then((s) => live && setSessions(s))
      .catch(() => live && setSessions([]));
    getEnvironment(sbx.environmentId)
      .then((e) => live && setEnv(e))
      .catch(() => live && setEnv('none'));
    return () => {
      live = false;
    };
  }, [sbx.sandboxId, sbx.environmentId]);

  // Escape closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // An action may return the sandbox id to follow afterwards (resume can recover onto a
  // NEW container, and with it a new id). Anything else just refreshes in place.
  const run = async (label: string, fn: () => Promise<string | unknown>) => {
    setBusy(label);
    setActionError(null);
    try {
      const followId = await fn();
      onChanged(typeof followId === 'string' ? followId : undefined);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // Delete with its own error handling: a 409 means the worktree is dirty, which
  // isn't a failure to surface as red text — it's a prompt to force. Flip into
  // force mode and let the user confirm the destructive path explicitly.
  const del = async (force: boolean) => {
    setBusy('delete');
    setActionError(null);
    try {
      await deleteSandbox(sbx.sandboxId, force);
      onClose();
      onChanged();
    } catch (e) {
      if (!force && e instanceof ApiError && e.status === 409) {
        setForceNeeded(true);
        setActionError(e.message);
      } else {
        setActionError((e as Error).message);
      }
    } finally {
      setBusy(null);
    }
  };

  // By SANDBOX id, not by its env: two workspaces on one image both match the env, and
  // the backend picked the first — so Open on this card could hand you the other one.
  const open = () =>
    run('open', () =>
      openWorkspace(sbx.sandboxId, {
        workspaceName: sbx.environmentId,
        verb: sbx.state === 'PAUSED' ? 'Resuming' : 'Opening',
      }),
    );

  const createdAt = new Date(sbx.createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <>
      <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-40" onClick={onClose} />
      <aside
        role="dialog"
        aria-label={`Sandbox ${sbx.environmentId}`}
        className="fixed top-0 right-0 h-full w-[min(440px,100vw)] bg-[#141417] border-l border-gray-700 shadow-2xl z-50 flex flex-col"
      >
        {/* header */}
        <div className="px-6 pt-5 pb-4 border-b border-gray-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h2 className="text-[17px] font-semibold truncate">{sbx.environmentId}</h2>
                <StatusPill state={sbx.state} />
              </div>
              <p className="mt-1.5 text-[11px] text-gray-600 font-mono truncate">sandbox {sbx.sandboxId}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="flex-none w-7 h-7 grid place-items-center rounded-md border border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600"
            >
              <VscClose />
            </button>
          </div>

          {/* tabs */}
          <div className="flex gap-1 mt-4">
            {(['ov', 'set', 'log'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative px-3 py-2.5 text-[13px] ${
                  tab === t ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t === 'ov' ? 'Overview' : t === 'set' ? 'Settings' : 'Logs'}
                {tab === t && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded bg-[#5ec8d8]" />}
              </button>
            ))}
          </div>
        </div>

        {/* body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {tab === 'ov' && (
          <>
          <dl className="grid grid-cols-[110px_1fr] gap-y-3 gap-x-3 text-[13px]">
            <dt className="text-gray-500">Environment</dt>
            <dd className="text-right break-all">{sbx.environmentId}</dd>
            <dt className="text-gray-500">State</dt>
            <dd className="text-right">{STATE_STYLE[sbx.state].label}</dd>
            <dt className="text-gray-500">Created</dt>
            <dd className="text-right">{createdAt}</dd>
            <dt className="text-gray-500">Last active</dt>
            <dd className="text-right">{timeAgo(sbx.lastActiveAt)}</dd>
            <dt className="text-gray-500">Workspace</dt>
            <dd className="text-right font-mono text-[12px]">/workspace</dd>
          </dl>

          {actionError && <p className="mt-4 text-[12px] text-[#f87171]">{actionError}</p>}

          {/* actions */}
          <div className="flex gap-2 mt-5">
            <button
              onClick={open}
              disabled={busy !== null}
              className="flex-1 flex items-center justify-center gap-2 text-[13px] font-semibold py-2.5 rounded-lg border border-[#5ec8d8]/50 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8] disabled:opacity-50"
            >
              <VscRootFolderOpened /> {busy === 'open' ? 'Opening…' : 'Open'}
            </button>

            {sbx.state === 'RUNNING' && (
              <button
                onClick={() => run('pause', () => pauseSandbox(sbx.sandboxId))}
                disabled={busy !== null}
                className="flex items-center justify-center gap-2 text-[13px] font-semibold py-2.5 px-4 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500 disabled:opacity-50"
              >
                <VscDebugPause /> {busy === 'pause' ? '…' : 'Pause'}
              </button>
            )}
            {/* Resume is offered on STOPPED/ERROR too, not just PAUSED: those are dead
                CONTAINERS, and the workspace behind them is intact. The backend recovers
                onto it and hands back the new sandbox id, which we then follow. */}
            {(sbx.state === 'PAUSED' || sbx.state === 'STOPPED' || sbx.state === 'ERROR') && (
              <button
                onClick={() =>
                  run('resume', async () => (await resumeSandbox(sbx.sandboxId)).sandboxId)
                }
                disabled={busy !== null}
                className="flex items-center justify-center gap-2 text-[13px] font-semibold py-2.5 px-4 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500 disabled:opacity-50"
              >
                <VscPlay /> {busy === 'resume' ? '…' : 'Resume'}
              </button>
            )}

            <button
              onClick={() => {
                setPromoting(true);
                setConfirming(false);
              }}
              disabled={busy !== null}
              aria-label="Promote to environment"
              title="Promote to a new environment"
              className="flex items-center justify-center py-2.5 px-3.5 rounded-lg border border-[#5ec8d8]/30 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8] disabled:opacity-50"
            >
              <VscCloudUpload />
            </button>

            <button
              onClick={() => {
                setConfirming(true);
                setPromoting(false);
              }}
              disabled={busy !== null}
              aria-label="Delete sandbox"
              className="flex items-center justify-center py-2.5 px-3.5 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171] hover:border-[#f87171] disabled:opacity-50"
            >
              <VscTrash />
            </button>
          </div>

          {/* Turn what you installed in here into a real, launchable environment. */}
          {promoting && (
            <PromoteSandbox
              sandboxId={sbx.sandboxId}
              environmentId={sbx.environmentId}
              onCancel={() => setPromoting(false)}
              onDone={() => {
                setPromoting(false);
                navigate('/environments'); // the new env is in the list, ready to build
              }}
            />
          )}

          {/* delete confirm — spells out the blast radius. Escalates to a
              force-delete once the clean path is rejected for a dirty worktree. */}
          {confirming && (
            <div className="mt-4 p-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/5">
              <p className="text-[13px] font-semibold mb-1">
                {forceNeeded ? 'Force-delete this sandbox?' : 'Delete this sandbox?'}
              </p>
              <p className="text-[12px] text-gray-400 leading-relaxed">
                {forceNeeded ? (
                  <>
                    This worktree has <span className="text-gray-200">uncommitted changes</span>. A normal
                    delete is blocked to protect them. Force-delete discards those changes and destroys
                    the container and its <code className="font-mono">/workspace</code> worktree anyway. This can’t be undone.
                  </>
                ) : (
                  <>
                    This destroys the container <span className="text-gray-200">and its <code className="font-mono">/workspace</code> worktree</span>. Uncommitted
                    files are gone, and any attached sessions are disconnected. This can’t be undone.
                  </>
                )}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => {
                    setConfirming(false);
                    setForceNeeded(false);
                    setActionError(null);
                  }}
                  disabled={busy !== null}
                  className="flex-1 text-[13px] py-2 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() => del(forceNeeded)}
                  disabled={busy !== null}
                  className="flex-1 text-[13px] font-semibold py-2 rounded-lg border border-[#f87171]/40 bg-[#f87171]/15 text-[#f87171] hover:border-[#f87171] disabled:opacity-50"
                >
                  {busy === 'delete'
                    ? forceNeeded ? 'Force-deleting…' : 'Deleting…'
                    : forceNeeded ? 'Force-delete' : 'Delete sandbox'}
                </button>
              </div>
            </div>
          )}

          {/* Sessions — the sandbox↔session distinction, made visible */}
          <section className="mt-7">
            <p className="text-[10.5px] uppercase tracking-wider text-gray-600 mb-2.5">
              Sessions{sessions ? ` · ${sessions.length}` : ''}
            </p>
            <p className="text-[11.5px] text-gray-600 leading-relaxed mb-3 pl-2.5 border-l-2 border-gray-700">
              Browser attachments to this sandbox. Closing one frees nothing — the idle sweeper decides
              when the container pauses.
            </p>
            {sessions === null ? (
              <p className="text-[12px] text-gray-600">Loading sessions…</p>
            ) : sessions.length === 0 ? (
              <p className="text-[12.5px] text-gray-600">No sessions have attached to this sandbox yet.</p>
            ) : (
              <div>
                {sessions.map((s) => {
                  const active = s.state === 'ACTIVE';
                  return (
                    <div
                      key={s.sessionId}
                      className="flex items-center gap-3 py-2.5 border-t border-gray-800 first:border-t-0"
                    >
                      <div className="flex-none w-7 h-7 rounded-full bg-[#212128] grid place-items-center text-[11px] text-gray-400 font-semibold uppercase">
                        {s.userId.slice(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12.5px] font-mono truncate">{s.userId.slice(0, 12)}</div>
                        <div className="text-[11px] text-gray-600 mt-0.5 font-mono truncate">
                          connected {timeAgo(s.connectedAt)} · {s.sessionId}
                        </div>
                      </div>
                      <span
                        className="flex-none text-[10.5px] font-semibold px-2 py-0.5 rounded-full lowercase"
                        style={
                          active
                            ? { color: '#34d399', background: 'rgba(52,211,153,.12)' }
                            : { color: '#5b5b65', background: '#212128' }
                        }
                      >
                        {active ? 'active' : s.state === 'CONNECTING' ? 'connecting' : 'ended'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          </>
          )}

          {tab === 'set' && <SettingsPanel env={env} />}
          {tab === 'log' && <LogsTab sandboxId={sbx.sandboxId} />}
        </div>
      </aside>
    </>
  );
}

// The Logs tab holds two views: the raw container stream and the audit trail.
// Activity is "who did what" (created / paused / sessions); Container is the process
// output. Same tab because both answer "what happened to this sandbox?".
function LogsTab({ sandboxId }: { sandboxId: string }) {
  const [view, setView] = useState<'container' | 'activity'>('activity');
  return (
    <>
      <div className="inline-flex mb-3 p-0.5 bg-[#0d0d0f] border border-gray-800 rounded-lg">
        {(['activity', 'container'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 text-[11px] rounded-md transition-colors ${
              view === v ? 'bg-gray-800 text-gray-200' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {v === 'activity' ? 'Activity' : 'Container'}
          </button>
        ))}
      </div>
      {view === 'activity' ? <ActivityPanel sandboxId={sandboxId} /> : <LogsPanel sandboxId={sandboxId} />}
    </>
  );
}

// The audit trail: created, state changes, sessions attaching/leaving. Newest first,
// from activity.json. A one-shot fetch — these events are historical, not a live feed.
function ActivityPanel({ sandboxId }: { sandboxId: string }) {
  const [events, setEvents] = useState<ActivitySummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setEvents(null);
    setError(false);
    listSandboxActivity(sandboxId)
      .then(setEvents)
      .catch(() => setError(true));
  }, [sandboxId]);

  if (error) return <p className="text-[12px] text-gray-600">Activity unavailable.</p>;
  if (events === null) return <p className="text-[12px] text-gray-600">Loading activity…</p>;
  if (events.length === 0) return <p className="text-[12px] text-gray-600">No activity recorded yet.</p>;

  const dot: Record<ActivitySummary['kind'], string> = {
    created: '#34d399',
    state: '#fbbf24',
    session_attached: '#60a5fa',
    session_left: '#8b8b96',
  };

  return (
    <div className="flex flex-col gap-px">
      {events.map((e) => (
        <div key={e.id} className="flex items-center gap-2.5 py-1.5 border-b border-gray-800/60 last:border-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dot[e.kind] }} />
          <span className="text-[12.5px] text-gray-300 flex-1">{e.message}</span>
          {e.actorId && (
            <span className="text-[10.5px] text-gray-600 font-mono">{e.actorId.slice(0, 8)}</span>
          )}
          <span className="text-[10.5px] text-gray-600 shrink-0">{timeAgo(e.at)}</span>
        </div>
      ))}
    </div>
  );
}

// Live container logs (docker logs -f), streamed as plain text. The container's
// PID 1 is `sleep infinity`, so a healthy sandbox is quiet — this is where boot
// and exit failures show up.
function LogsPanel({ sandboxId }: { sandboxId: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<'connecting' | 'streaming' | 'ended' | 'error'>('connecting');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    let buf = '';
    setLines([]);
    setStatus('connecting');

    streamSandboxLogs(sandboxId, ac.signal)
      .then(async (res) => {
        if (!res.ok || !res.body) {
          setStatus('error');
          setLines([`Could not load logs (${res.status}).`]);
          return;
        }
        setStatus('streaming');
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n');
          buf = parts.pop() ?? '';
          if (parts.length) setLines((prev) => [...prev, ...parts].slice(-1000)); // cap memory
        }
        setStatus('ended');
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setStatus('error');
      });

    return () => ac.abort();
  }, [sandboxId]);

  // Follow the tail as new lines arrive.
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const lineColor = (l: string) => {
    if (/\b(error|fatal|panic|exited|failed)\b/i.test(l)) return '#f87171';
    if (/\b(warn|warning)\b/i.test(l)) return '#fbbf24';
    return '#8b8b96';
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10.5px] uppercase tracking-wider text-gray-600">Container logs</p>
        <span className="text-[10.5px] text-gray-600">
          {status === 'streaming' ? 'live' : status === 'connecting' ? 'connecting…' : status === 'error' ? 'error' : 'ended'}
        </span>
      </div>
      <div
        ref={boxRef}
        className="font-mono text-[11.5px] leading-relaxed bg-[#0d0d0f] border border-gray-800 rounded-lg p-3 max-h-[420px] overflow-auto"
      >
        {lines.length === 0 ? (
          <p className="text-gray-600">
            {status === 'error'
              ? 'Logs unavailable.'
              : 'No container output. This sandbox runs `sleep infinity`, so only startup errors and its own stdout appear here.'}
          </p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="whitespace-pre-wrap break-words" style={{ color: lineColor(l) }}>
              {l}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// Configuration view. A sandbox is immutable — its image and env come from its
// environment, so this is read-only and points you there to change anything.
function SettingsPanel({ env }: { env: SavedEnvironment | null | 'none' }) {
  if (env === null) return <p className="text-[12px] text-gray-600">Loading configuration…</p>;
  if (env === 'none')
    return (
      <p className="text-[12.5px] text-gray-600">
        This sandbox was created directly and has no linked environment to configure.
      </p>
    );

  const cfg = env.builderConfig;
  const vars = cfg?.env ? Object.entries(cfg.env) : [];

  return (
    <>
      <p className="text-[11.5px] text-gray-500 leading-relaxed mb-4 pl-2.5 border-l-2 border-gray-700">
        A sandbox is immutable — its image and variables come from its environment. Edit the environment
        and rebuild to change them.
      </p>

      <dl className="grid grid-cols-[110px_1fr] gap-y-3 gap-x-3 text-[13px]">
        <dt className="text-gray-500">Environment</dt>
        <dd className="text-right font-mono text-[12px] break-all">{env.id}</dd>
        <dt className="text-gray-500">Base image</dt>
        <dd className="text-right font-mono text-[12px]">{cfg?.baseImage ?? '—'}</dd>
        <dt className="text-gray-500">Built image</dt>
        <dd className="text-right font-mono text-[12px] break-all">{env.imageName || 'not built yet'}</dd>
      </dl>

      <section className="mt-6">
        <p className="text-[10.5px] uppercase tracking-wider text-gray-600 mb-2.5">Environment variables</p>
        {vars.length === 0 ? (
          <p className="text-[12.5px] text-gray-600">None set on the environment.</p>
        ) : (
          <div className="rounded-lg border border-gray-800 bg-[#0d0d0f] divide-y divide-gray-800">
            {vars.map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 px-3 py-2 text-[12px] font-mono">
                <span className="text-gray-400 flex-none">{k}</span>
                <span className="text-gray-600 flex-none">=</span>
                <span className="text-gray-300 truncate">{v}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-600 mt-2">Read-only — applied at boot. Change them on the environment.</p>
      </section>

      <button
        onClick={() => navigate('/environments')}
        className="mt-6 w-full flex items-center justify-center gap-2 text-[13px] font-semibold py-2.5 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500"
      >
        <VscRocket /> Open environment
      </button>
    </>
  );
}
