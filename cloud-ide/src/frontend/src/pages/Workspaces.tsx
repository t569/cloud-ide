// The /workspaces page (workspace-entity.md): the durable, compute-independent half of a
// sandbox, tracked as a first-class entity. List your workspaces, create one (blank or
// cloned from a git URL), launch it INTO a fresh sandbox on a chosen environment, or delete
// it. A workspace outlives the containers it's injected into — that's the whole point.
import React, { useEffect, useState } from 'react';
import { VscRepo, VscAdd, VscTrash, VscRocket, VscServerProcess, VscClose, VscPulse, VscRefresh } from 'react-icons/vsc';
import { listWorkspaces, createWorkspace, deleteWorkspace, type Workspace } from '../api/workspaces';
import { listEnvironments, type SavedEnvironment } from '../env-manager/services/api/environmentApi';
import { launchEnvironment } from './launch';
import { navigate } from './router';
import { toast } from '../notifications';
import { timeAgo } from '../env-manager/utils/timeAgo';

const SOURCE_STYLE: Record<Workspace['source'], { label: string; color: string }> = {
  'git-url': { label: 'Git', color: '#5ec8d8' },
  blank: { label: 'Blank', color: '#8b8b96' },
  'host-folder': { label: 'Host', color: '#fbbf24' },
};

export default function Workspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [launching, setLaunching] = useState<Workspace | null>(null);

  const refresh = () => {
    setLoading(true);
    listWorkspaces()
      .then((w) => { setWorkspaces(w); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(refresh, []);

  const remove = async (w: Workspace) => {
    try {
      await deleteWorkspace(w.id);
      toast.success(`Workspace “${w.name}” deleted.`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message, { title: 'Could not delete workspace' });
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-gray-200 p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <VscRepo /> Workspaces
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Durable, reusable working sets — inject one into a fresh sandbox any time. A workspace
            outlives the containers it runs in.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-[#5ec8d8]/40 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8]"
          >
            <VscAdd /> New workspace
          </button>
          <button onClick={refresh} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600">
            <VscRefresh className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => navigate('/sandboxes')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600">
            <VscServerProcess /> Sandboxes
          </button>
          <button onClick={() => navigate('/health')} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600">
            <VscPulse /> Health
          </button>
        </div>
      </header>

      {error && <p className="text-sm text-[#f87171]">Could not load workspaces: {error}</p>}

      {!error && !loading && workspaces.length === 0 && (
        <p className="text-sm text-gray-500">
          No workspaces yet.{' '}
          <button onClick={() => setCreating(true)} className="text-gray-300 underline">Create one</button>{' '}
          — blank, or cloned from a git repo.
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
        {workspaces.map((w) => {
          const s = SOURCE_STYLE[w.source];
          return (
            <div key={w.id} className="p-4 rounded-lg border border-gray-800 bg-[#141417] flex flex-col">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="font-medium truncate">{w.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded flex-none" style={{ color: s.color, background: `${s.color}1f` }}>
                  {s.label}
                </span>
              </div>
              {w.sourceUrl && <p className="text-[11px] text-gray-500 font-mono truncate">{w.sourceUrl}</p>}
              <p className="text-[11px] text-gray-600 mt-2">
                {w.persistence} · created {timeAgo(w.createdAt)}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setLaunching(w)}
                  className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold py-1.5 rounded border border-[#5ec8d8]/50 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8]"
                >
                  <VscRocket /> Launch
                </button>
                <button
                  onClick={() => remove(w)}
                  aria-label={`Delete ${w.name}`}
                  className="flex items-center justify-center py-1.5 px-3 rounded border border-[#f87171]/30 bg-[#f87171]/10 text-[#f87171] hover:border-[#f87171]"
                >
                  <VscTrash />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {creating && <NewWorkspaceDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refresh(); }} />}
      {launching && <LaunchWorkspaceDialog workspace={launching} onClose={() => setLaunching(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<'blank' | 'git-url'>('blank');
  const [sourceUrl, setSourceUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!name.trim()) { setError('Give the workspace a name.'); return; }
    if (source === 'git-url' && !/^https:\/\/.+/i.test(sourceUrl.trim())) {
      setError('Enter an https git URL.');
      return;
    }
    setBusy(true);
    try {
      await createWorkspace({
        name: name.trim(),
        source,
        sourceUrl: source === 'git-url' ? sourceUrl.trim() : undefined,
      });
      toast.success(`Workspace “${name.trim()}” created.`);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="New workspace" onClose={onClose}>
      <label className="block text-[12px] text-gray-500 mb-1.5">Name</label>
      <input
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        placeholder="My project"
        autoFocus
        className="w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] text-gray-200 outline-none focus:border-[#5ec8d8]/60 placeholder:text-gray-600"
      />

      <label className="block text-[12px] text-gray-500 mt-4 mb-1.5">Source</label>
      <div className="flex gap-2">
        {(['blank', 'git-url'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSource(s); setError(null); }}
            className={`flex-1 text-[12.5px] py-2 rounded-lg border ${
              source === s ? 'border-[#5ec8d8]/60 bg-[#5ec8d8]/10 text-[#5ec8d8]' : 'border-gray-800 bg-[#0d0d0f] text-gray-400 hover:border-gray-600'
            }`}
          >
            {s === 'blank' ? 'Blank' : 'Clone git repo'}
          </button>
        ))}
      </div>

      {source === 'git-url' && (
        <input
          value={sourceUrl}
          onChange={(e) => { setSourceUrl(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="https://github.com/owner/repo"
          className="w-full mt-3 rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] font-mono text-gray-200 outline-none focus:border-[#5ec8d8]/60 placeholder:text-gray-600"
        />
      )}

      <p className="mt-3 text-[11.5px] leading-snug text-gray-500">
        A blank workspace starts empty; a git one clones the repo when first launched. Private repos
        use the token saved in the editor's Source Control pane.
      </p>
      {error && <p className="mt-3 text-[12px] text-[#f87171]">{error}</p>}

      <DialogButtons onClose={onClose} onConfirm={submit} busy={busy} confirmLabel="Create" />
    </Modal>
  );
}

function LaunchWorkspaceDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const [envs, setEnvs] = useState<SavedEnvironment[] | null>(null);
  const [envId, setEnvId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listEnvironments()
      .then((all) => {
        const built = all.filter((e) => e.imageName);
        setEnvs(built);
        if (built[0]) setEnvId(built[0].id);
      })
      .catch(() => setEnvs([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    if (!envId) { setError('Pick an environment to run it in.'); return; }
    onClose();
    void launchEnvironment(envId, { fresh: true, workspaceId: workspace.id, workspaceName: workspace.name });
  };

  return (
    <Modal title={`Launch “${workspace.name}”`} onClose={onClose}>
      <p className="text-[12.5px] text-gray-400 mb-4">
        Injects this workspace into a fresh sandbox. Choose the environment (image) it runs in.
      </p>
      <label className="block text-[12px] text-gray-500 mb-1.5">Environment</label>
      <select
        value={envId}
        onChange={(e) => { setEnvId(e.target.value); setError(null); }}
        disabled={!envs || envs.length === 0}
        className="w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] text-gray-200 outline-none focus:border-[#5ec8d8]/60 disabled:opacity-50"
      >
        {envs === null && <option>Loading…</option>}
        {envs?.length === 0 && <option value="">No built environments — build one first</option>}
        {envs?.map((e) => <option key={e.id} value={e.id}>{e.builderConfig?.name || e.id}</option>)}
      </select>
      {error && <p className="mt-3 text-[12px] text-[#f87171]">{error}</p>}
      <DialogButtons onClose={onClose} onConfirm={submit} busy={false} confirmLabel="Launch" confirmDisabled={!envs || envs.length === 0} />
    </Modal>
  );
}

// Shared modal chrome — matches the SandboxDrawer / CloneRepoDialog dashboard styling.
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={title}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(460px,92vw)] bg-[#141417] border border-gray-700 rounded-xl shadow-2xl z-50 p-6"
      >
        <div className="flex items-start justify-between mb-5">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 grid place-items-center rounded-md border border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600">
            <VscClose />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function DialogButtons({
  onClose, onConfirm, busy, confirmLabel, confirmDisabled,
}: { onClose: () => void; onConfirm: () => void; busy: boolean; confirmLabel: string; confirmDisabled?: boolean }) {
  return (
    <div className="flex gap-2 mt-5">
      <button onClick={onClose} className="flex-1 text-[13px] py-2 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500">
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || confirmDisabled}
        className="flex-1 text-[13px] font-semibold py-2 rounded-lg border border-[#5ec8d8]/50 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8] disabled:opacity-50"
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
    </div>
  );
}
