// The /sandboxes page (Step 12b). Lists the sandboxes this user owns and reopens
// one on click. Opening routes through the shared launch flow, so a PAUSED sandbox
// is resumed by POST /v1/sessions rather than by anything special here.
import React, { useEffect, useState } from 'react';
import { VscPulse, VscRefresh, VscServerProcess, VscRocket } from 'react-icons/vsc';
import { listSandboxes, type SandboxSummary } from '../api/sandbox';
import type { SandboxState } from '@cloud-ide/shared/types/sandbox';
import { timeAgo } from '../env-manager/utils/timeAgo';
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
  const [opening, setOpening] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    listSandboxes()
      .then((list) => {
        setSandboxes(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  // "Resuming" only when it's actually asleep; launchEnvironment handles the wait,
  // the toast and the navigate. `opening` just disables the card meanwhile.
  const open = async (sbx: SandboxSummary) => {
    setOpening(sbx.sandboxId);
    await launchEnvironment(sbx.environmentId, {
      workspaceName: sbx.environmentId,
      verb: sbx.state === 'PAUSED' ? 'Resuming' : 'Opening',
    });
    setOpening(null);
  };

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-gray-200 p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <VscServerProcess /> Sandboxes
          </h1>
          <p className="text-xs text-gray-500 mt-1">Your running and paused workspaces.</p>
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
            onClick={() => open(sbx)}
            disabled={opening !== null}
            className="text-left p-4 rounded-lg border border-gray-800 bg-[#141417] hover:border-gray-600 disabled:opacity-50"
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
    </div>
  );
}
