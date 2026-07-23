// The /workspaces page (workspace-entity.md): the durable, compute-independent half of a
// sandbox, tracked as a first-class entity. List your workspaces, create one (blank or
// cloned from a git URL), launch it INTO a fresh sandbox on a chosen environment, or delete
// it. A workspace outlives the containers it's injected into — that's the whole point.
import React, { useEffect, useState } from 'react';
import { VscRepo, VscAdd, VscTrash, VscRocket, VscServerProcess, VscClose, VscPulse, VscRefresh, VscGithub, VscKey } from 'react-icons/vsc';
import {
  listWorkspaces, createWorkspace, deleteWorkspace, uploadWorkspaceArchive,
  setWorkspaceCredential, clearWorkspaceCredential, type Workspace,
} from '../api/workspaces';
import { getGitCredential, setGitCredential, clearGitCredential, type GitCredentialState } from '../api/git';
import { listEnvironments, type SavedEnvironment } from '../env-manager/services/api/environmentApi';
import { launchEnvironment } from './launch';
import { navigate } from './router';
import { toast } from '../notifications';
import { timeAgo } from '../env-manager/utils/timeAgo';

const SOURCE_STYLE: Record<Workspace['source'], { label: string; color: string }> = {
  'git-url': { label: 'Git', color: '#5ec8d8' },
  blank: { label: 'Blank', color: '#8b8b96' },
  archive: { label: 'Upload', color: '#a78bfa' },
};

export default function Workspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [launching, setLaunching] = useState<Workspace | null>(null);
  const [tokening, setTokening] = useState<Workspace | null>(null);

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
          <GitHubConnect />
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
                {w.source === 'git-url' && (
                  <button
                    onClick={() => setTokening(w)}
                    aria-label={`${w.hasCredential ? 'Change' : 'Add'} access token for ${w.name}`}
                    title={w.hasCredential ? `Repo token set (${w.credentialHost})` : 'Add a repo access token'}
                    className={`flex items-center justify-center py-1.5 px-3 rounded border ${
                      w.hasCredential
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:border-emerald-500'
                        : 'border-gray-800 text-gray-400 hover:border-gray-600'
                    }`}
                  >
                    <VscKey />
                  </button>
                )}
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
      {tokening && <WorkspaceTokenDialog workspace={tokening} onClose={() => setTokening(null)} onChange={refresh} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewWorkspaceDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<'blank' | 'git-url' | 'archive'>('blank');
  const [sourceUrl, setSourceUrl] = useState('');
  /** The .zip for an `archive` workspace. Uploaded AFTER create — the id only exists then. */
  const [archive, setArchive] = useState<File | null>(null);
  // Optional repo-specific PAT. Applied AFTER create (the workspace id only exists then);
  // blank falls back to the account token at launch.
  const [wsToken, setWsToken] = useState('');
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
    if (source === 'archive' && !archive) { setError('Choose a .zip to upload.'); return; }
    setBusy(true);
    try {
      // An archive workspace is created BLANK and then given its source by the upload:
      // the upload endpoint needs an id to unpack into, and a workspace should never
      // advertise a source whose bytes failed to extract.
      const created = await createWorkspace({
        name: name.trim(),
        source: source === 'archive' ? 'blank' : source,
        sourceUrl: source === 'git-url' ? sourceUrl.trim() : undefined,
      });
      if (source === 'git-url' && wsToken.trim()) {
        await setWorkspaceCredential(created.id, wsToken.trim());
      }
      if (source === 'archive' && archive) {
        const { files } = await uploadWorkspaceArchive(created.id, archive);
        toast.success(`Workspace “${name.trim()}” created — ${files} file${files === 1 ? '' : 's'} uploaded.`);
        onCreated();
        return;
      }
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
        {(['blank', 'git-url', 'archive'] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSource(s); setError(null); }}
            className={`flex-1 text-[12.5px] py-2 rounded-lg border ${
              source === s ? 'border-[#5ec8d8]/60 bg-[#5ec8d8]/10 text-[#5ec8d8]' : 'border-gray-800 bg-[#0d0d0f] text-gray-400 hover:border-gray-600'
            }`}
          >
            {s === 'blank' ? 'Blank' : s === 'git-url' ? 'Clone repo' : 'Upload .zip'}
          </button>
        ))}
      </div>

      {source === 'archive' && (
        <>
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={(e) => { setArchive(e.target.files?.[0] ?? null); setError(null); }}
            className="mt-3 w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[12.5px] text-gray-400 file:mr-3 file:rounded-md file:border-0 file:bg-[#5ec8d8]/15 file:px-3 file:py-1 file:text-[12px] file:text-[#5ec8d8] hover:file:bg-[#5ec8d8]/25"
          />
          <p className="mt-1.5 text-[11.5px] leading-snug text-gray-500">
            Zip your project folder and drop it here (100 MB max). If it contains a{' '}
            <span className="font-mono text-gray-300">.git</span> directory its history comes
            with it; otherwise the upload becomes the first commit.
          </p>
        </>
      )}

      {source === 'git-url' && (
        <>
          <input
            value={sourceUrl}
            onChange={(e) => { setSourceUrl(e.target.value); setError(null); }}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="https://github.com/owner/repo"
            className="w-full mt-3 rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] font-mono text-gray-200 outline-none focus:border-[#5ec8d8]/60 placeholder:text-gray-600"
          />
          <label className="block text-[12px] text-gray-500 mt-4 mb-1.5">
            Repo access token <span className="text-gray-600">· optional</span>
          </label>
          <input
            type="password"
            value={wsToken}
            onChange={(e) => setWsToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="ghp_… — private repos only"
            className="w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] font-mono text-gray-200 outline-none focus:border-[#5ec8d8]/60 placeholder:text-gray-600"
          />
          <p className="mt-1.5 text-[11.5px] leading-snug text-gray-500">
            Used only for this workspace (stored encrypted). Leave blank to fall back to your account
            token — <span className="text-gray-300">Connect GitHub</span> in the header.
          </p>
        </>
      )}

      <p className="mt-3 text-[11.5px] leading-snug text-gray-500">
        A blank workspace starts empty; a git one clones the repo when first launched.
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

// Per-workspace access token (workspace-entity.md). Overrides the account token when THIS
// workspace launches (server precedence: workspace token → account token). Set once at
// create or rotated here; the secret is write-only — the browser only learns has/host.
function WorkspaceTokenDialog({
  workspace, onClose, onChange,
}: { workspace: Workspace; onClose: () => void; onChange: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try {
      await setWorkspaceCredential(workspace.id, token.trim());
      onChange();
      onClose();
      toast.success(`Token set for “${workspace.name}”.`);
    } catch (e) {
      toast.error((e as Error).message, { title: 'Could not save token' });
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await clearWorkspaceCredential(workspace.id);
      onChange();
      onClose();
      toast.success(`Token removed — “${workspace.name}” falls back to your account token.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Modal title={`Access token — “${workspace.name}”`} onClose={onClose}>
      {workspace.hasCredential && (
        <p className="text-[12.5px] text-emerald-400 mb-3 flex items-center gap-1.5">
          <VscKey /> A repo token is set ({workspace.credentialHost}). Enter a new one to replace it.
        </p>
      )}
      <label className="block text-[12px] text-gray-500 mb-1.5">Personal access token</label>
      <input
        type="password"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        placeholder="ghp_…"
        autoFocus
        className="w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] font-mono text-gray-200 outline-none focus:border-[#5ec8d8]/60 placeholder:text-gray-600"
      />
      <p className="mt-3 text-[11.5px] leading-snug text-gray-500">
        Used only when this workspace clones/pushes — overrides your account token. Stored encrypted
        server-side; it never comes back to the browser. A classic token with <code>repo</code> scope works.
      </p>
      <div className="flex gap-2 mt-5">
        <button onClick={onClose} className="flex-1 text-[13px] py-2 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500">
          Cancel
        </button>
        {workspace.hasCredential && (
          <button onClick={remove} className="flex-1 text-[13px] font-semibold py-2 rounded-lg border border-[#f87171]/40 bg-[#f87171]/10 text-[#f87171] hover:border-[#f87171]">
            Remove
          </button>
        )}
        <button
          onClick={save}
          disabled={busy || !token.trim()}
          className="flex-1 text-[13px] font-semibold py-2 rounded-lg border border-[#5ec8d8]/50 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8] disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

// Account-level GitHub connection (user-scoped PAT). Needed to clone/launch PRIVATE
// workspaces — the credential is resolved server-side at launch time. Same encrypted
// per-user store the editor's Source Control pane uses; surfaced here so you can connect
// BEFORE launching a private repo, without opening a sandbox first.
function GitHubConnect() {
  const [cred, setCred] = useState<GitCredentialState | null>(null);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => getGitCredential().then(setCred).catch(() => setCred({ configured: false, host: null }));
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try {
      await setGitCredential(token.trim());
      await load();
      setToken('');
      setOpen(false);
      toast.success('GitHub connected — private repos can now be cloned.');
    } catch (e) {
      toast.error((e as Error).message, { title: 'Could not save token' });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    try {
      await clearGitCredential();
      await load();
      toast.success('GitHub disconnected.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Connect a GitHub token for private repos"
        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border ${
          cred?.configured
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
            : 'border-gray-800 text-gray-400 hover:border-gray-600'
        }`}
      >
        <VscGithub /> {cred?.configured ? `GitHub: ${cred.host}` : 'Connect GitHub'}
      </button>
      {open && (
        <Modal title="Connect GitHub" onClose={() => setOpen(false)}>
          {cred?.configured ? (
            <>
              <p className="text-[12.5px] text-gray-400">
                Connected to <span className="text-gray-200">{cred.host}</span>. Private workspaces
                clone with this token.
              </p>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setOpen(false)} className="flex-1 text-[13px] py-2 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500">
                  Close
                </button>
                <button onClick={disconnect} className="flex-1 text-[13px] font-semibold py-2 rounded-lg border border-[#f87171]/40 bg-[#f87171]/10 text-[#f87171] hover:border-[#f87171]">
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="block text-[12px] text-gray-500 mb-1.5">Personal access token</label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                placeholder="ghp_…"
                autoFocus
                className="w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] font-mono text-gray-200 outline-none focus:border-[#5ec8d8]/60 placeholder:text-gray-600"
              />
              <p className="mt-3 text-[11.5px] leading-snug text-gray-500">
                Needed to clone/launch private repos and to push. Stored encrypted server-side; it
                never comes back to the browser. A classic token with <code>repo</code> scope works.
              </p>
              <DialogButtons onClose={() => setOpen(false)} onConfirm={save} busy={busy} confirmLabel="Connect" confirmDisabled={!token.trim()} />
            </>
          )}
        </Modal>
      )}
    </>
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
