// The /sandboxes page (Step 12b). Lists the sandboxes this user owns; clicking one
// opens a detail drawer (Overview) to inspect it, open the workspace, pause/resume,
// or delete it. Opening still routes through the shared launch flow, so a PAUSED
// sandbox is resumed by POST /v1/sessions rather than by anything special here.
import React, { useEffect, useState } from 'react';
import { VscPulse, VscRefresh, VscServerProcess, VscRocket, VscClose, VscDebugPause, VscPlay, VscTrash, VscRootFolderOpened } from 'react-icons/vsc';
import {
  listSandboxes,
  deleteSandbox,
  pauseSandbox,
  resumeSandbox,
  listSandboxSessions,
  type SandboxSummary,
  type SessionSummary,
} from '../api/sandbox';
import type { SandboxState } from '@cloud-ide/shared/types/sandbox';
import { timeAgo } from '../env-manager/utils/timeAgo';
import { getEnvironment, type SavedEnvironment } from '../env-manager/services/api/environmentApi';
import { launchEnvironment } from './launch';
import { navigate } from './router';

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

  const refresh = () => {
    setLoading(true);
    listSandboxes()
      .then((list) => {
        setSandboxes(list);
        setError(null);
        // Keep the drawer's data fresh (or close it if the sandbox is gone).
        setSelected((cur) => (cur ? list.find((s) => s.sandboxId === cur.sandboxId) ?? null : null));
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
            onClick={refresh}
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
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<null | string>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tab, setTab] = useState<'ov' | 'set'>('ov');
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

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(label);
    setActionError(null);
    try {
      await fn();
      after?.();
      onChanged();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const open = () =>
    run('open', () =>
      launchEnvironment(sbx.environmentId, {
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
            {(['ov', 'set'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative px-3 py-2.5 text-[13px] ${
                  tab === t ? 'text-gray-100' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t === 'ov' ? 'Overview' : 'Settings'}
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
            {sbx.state === 'PAUSED' && (
              <button
                onClick={() => run('resume', () => resumeSandbox(sbx.sandboxId))}
                disabled={busy !== null}
                className="flex items-center justify-center gap-2 text-[13px] font-semibold py-2.5 px-4 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500 disabled:opacity-50"
              >
                <VscPlay /> {busy === 'resume' ? '…' : 'Resume'}
              </button>
            )}

            <button
              onClick={() => setConfirming(true)}
              disabled={busy !== null}
              aria-label="Delete sandbox"
              className="flex items-center justify-center py-2.5 px-3.5 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171] hover:border-[#f87171] disabled:opacity-50"
            >
              <VscTrash />
            </button>
          </div>

          {/* delete confirm — spells out the blast radius */}
          {confirming && (
            <div className="mt-4 p-4 rounded-lg border border-[#f87171]/30 bg-[#f87171]/5">
              <p className="text-[13px] font-semibold mb-1">Delete this sandbox?</p>
              <p className="text-[12px] text-gray-400 leading-relaxed">
                This destroys the container <span className="text-gray-200">and its <code className="font-mono">/workspace</code> worktree</span>. Uncommitted
                files are gone, and any attached sessions are disconnected. This can’t be undone.
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy !== null}
                  className="flex-1 text-[13px] py-2 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() =>
                    run('delete', () => deleteSandbox(sbx.sandboxId), onClose)
                  }
                  disabled={busy !== null}
                  className="flex-1 text-[13px] font-semibold py-2 rounded-lg border border-[#f87171]/40 bg-[#f87171]/15 text-[#f87171] hover:border-[#f87171] disabled:opacity-50"
                >
                  {busy === 'delete' ? 'Deleting…' : 'Delete sandbox'}
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
        </div>
      </aside>
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
