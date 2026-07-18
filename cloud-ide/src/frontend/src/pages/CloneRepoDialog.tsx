// "Clone repository" launcher (clone-on-create, git-integration.md). Creates a NEW
// workspace on a chosen environment whose /workspace is a clone of the given git URL —
// POST /v1/sessions { environmentId, fresh: true, repoUrl }, resolved server-side with
// the caller's stored PAT for private repos. The environment supplies the image; the
// repo supplies the initial files.
import React, { useEffect, useState } from 'react';
import { VscClose, VscRepoClone } from 'react-icons/vsc';
import { listEnvironments, type SavedEnvironment } from '../env-manager/services/api/environmentApi';
import { launchEnvironment } from './launch';
import { toast } from '../notifications';

/** octocat/Hello-World.git → "octocat/Hello-World" for the workspace label. */
function repoLabel(url: string): string {
  return url.replace(/\.git$/i, '').split('/').filter(Boolean).slice(-2).join('/') || 'repository';
}

export function CloneRepoDialog({ onClose }: { onClose: () => void }) {
  const [envs, setEnvs] = useState<SavedEnvironment[] | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [envId, setEnvId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listEnvironments()
      .then((all) => {
        const built = all.filter((e) => e.imageName); // only launchable (built) envs
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

  const submit = async () => {
    const url = repoUrl.trim();
    if (!/^https:\/\/.+/i.test(url)) {
      setError('Enter an https git URL (e.g. https://github.com/owner/repo).');
      return;
    }
    if (!envId) {
      setError('Pick an environment to clone into.');
      return;
    }
    setBusy(true);
    // launch() owns the pending toast, waitForRunning, and navigation into the editor;
    // it never throws (errors surface as a toast), so we just close and let it drive.
    onClose();
    void launchEnvironment(envId, { fresh: true, repoUrl: url, workspaceName: repoLabel(url) });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/55 backdrop-blur-[2px] z-40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Clone a repository"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(460px,92vw)] bg-[#141417] border border-gray-700 rounded-xl shadow-2xl z-50 p-6"
      >
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <VscRepoClone className="text-[#5ec8d8]" size={18} />
            <h2 className="text-[16px] font-semibold">Clone a repository</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 grid place-items-center rounded-md border border-gray-800 text-gray-400 hover:text-gray-200 hover:border-gray-600"
          >
            <VscClose />
          </button>
        </div>

        <label className="block text-[12px] text-gray-500 mb-1.5">Repository URL</label>
        <input
          value={repoUrl}
          onChange={(e) => { setRepoUrl(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="https://github.com/owner/repo"
          autoFocus
          className="w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] font-mono text-gray-200 outline-none focus:border-[#5ec8d8]/60 placeholder:text-gray-600"
        />

        <label className="block text-[12px] text-gray-500 mt-4 mb-1.5">Environment (image)</label>
        <select
          value={envId}
          onChange={(e) => { setEnvId(e.target.value); setError(null); }}
          disabled={!envs || envs.length === 0}
          className="w-full rounded-lg border border-gray-800 bg-[#0d0d0f] px-3 py-2 text-[13px] text-gray-200 outline-none focus:border-[#5ec8d8]/60 disabled:opacity-50"
        >
          {envs === null && <option>Loading…</option>}
          {envs?.length === 0 && <option value="">No built environments — build one first</option>}
          {envs?.map((e) => (
            <option key={e.id} value={e.id}>{e.builderConfig?.name || e.id}</option>
          ))}
        </select>

        <p className="mt-3 text-[11.5px] leading-snug text-gray-500">
          Creates a new workspace on that environment, cloned from the URL. Private repos use the
          GitHub token saved in the editor's Source Control pane.
        </p>

        {error && <p className="mt-3 text-[12px] text-[#f87171]">{error}</p>}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 text-[13px] py-2 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !envs || envs.length === 0}
            className="flex-1 flex items-center justify-center gap-2 text-[13px] font-semibold py-2 rounded-lg border border-[#5ec8d8]/50 bg-[#5ec8d8]/10 text-[#5ec8d8] hover:border-[#5ec8d8] disabled:opacity-50"
          >
            <VscRepoClone /> Clone & open
          </button>
        </div>
      </div>
    </>
  );
}
