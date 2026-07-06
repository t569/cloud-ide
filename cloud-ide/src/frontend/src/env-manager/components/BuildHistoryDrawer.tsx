import React, { useCallback, useEffect, useState } from 'react';
import { VscClose, VscHistory, VscRefresh, VscLoading, VscCloudUpload, VscCheck } from 'react-icons/vsc';
import { toast } from '@frontend/notifications';
import {
  BuildState,
  SavedEnvironment,
  listBuilds,
  rollbackEnvironment,
} from '../services/api/environmentApi';
import { timeAgo } from '../utils/timeAgo';

const STATUS_COLOR: Record<string, string> = {
  queued: '#fbbf24',
  building: '#fbbf24',
  succeeded: '#34d399',
  failed: '#f87171',
};
const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  building: 'Building',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

const formatDuration = (b: BuildState): string => {
  if (!b.finishedAt || !b.startedAt) return '—';
  const secs = Math.max(0, Math.round((b.finishedAt - b.startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
};

const BuildRow = ({
  b,
  isCurrent,
  deploying,
  onDeploy,
}: {
  b: BuildState;
  isCurrent: boolean;
  deploying: boolean;
  onDeploy: () => void;
}) => {
  const color = STATUS_COLOR[b.status] ?? '#9ca3af';
  const canDeploy = b.status === 'succeeded' && !!b.imageTag;
  return (
    <div className="p-3 rounded-lg border border-white/[0.06] bg-[#1f1f1f] animate-fade-up">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
          {b.status === 'building' ? (
            <VscLoading size={12} className="animate-spin" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
          )}
          {STATUS_LABEL[b.status] ?? b.status}
        </span>
        <span className="text-[11px] text-gray-500">{b.startedAt ? timeAgo(b.startedAt) : '—'}</span>
      </div>

      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] font-jetbrains text-gray-500">
        <span>Duration</span>
        <span className="text-right text-gray-300">{formatDuration(b)}</span>
        {b.imageTag && (
          <>
            <span>Image</span>
            <span className="text-right text-gray-300 truncate">{b.imageTag}</span>
          </>
        )}
        <span>Build</span>
        <span className="text-right text-gray-600 truncate">{b.buildId ?? '—'}</span>
      </div>

      {b.error && (
        <p className="mt-2 text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded p-2 break-words font-jetbrains">
          {b.error}
        </p>
      )}

      {canDeploy && (
        <div className="mt-2.5 flex justify-end">
          {isCurrent ? (
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
              <VscCheck size={13} /> Currently serving
            </span>
          ) : (
            <button
              type="button"
              onClick={onDeploy}
              disabled={deploying}
              className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-[#3574d4]/30 text-[#5a9cf8] bg-[#3574d4]/10 hover:bg-[#3574d4]/20 transition-colors active:scale-95 disabled:opacity-50"
            >
              <VscCloudUpload size={13} />
              {deploying ? 'Deploying…' : 'Deploy this build'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const BuildHistoryDrawer = ({
  env,
  onClose,
  onDeployed,
}: {
  env: SavedEnvironment;
  onClose: () => void;
  onDeployed?: () => void;
}) => {
  const [builds, setBuilds] = useState<BuildState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which image :latest currently points at (seeded from the record, updated on deploy).
  const [currentImage, setCurrentImage] = useState<string>(env.imageName);
  const [deploying, setDeploying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBuilds(await listBuilds(env.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [env.id]);

  const handleDeploy = async (imageTag: string) => {
    setDeploying(imageTag);
    try {
      await rollbackEnvironment(env.id, imageTag);
      setCurrentImage(imageTag);
      toast.success(`Now serving ${imageTag}`, { title: 'Deployed' });
      onDeployed?.(); // let the parent refresh the env list
    } catch (e) {
      toast.error((e as Error).message, { title: 'Deploy failed' });
    } finally {
      setDeploying(null);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const name = env.builderConfig?.name || env.id;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px] animate-fade-in" onClick={onClose}>
      <div
        className="w-[420px] max-w-full h-full bg-[#1c1c1c] border-l border-white/[0.08] shadow-2xl flex flex-col animate-drawer"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-b from-[#2d2d2d] to-[#262626] border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <VscHistory className="text-[#3574d4] flex-shrink-0" size={17} />
            <span className="text-sm font-semibold text-gray-100 truncate">Build History · {name}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={load}
              aria-label="Refresh history"
              className="p-1.5 rounded text-gray-400 hover:text-gray-100 hover:bg-white/10 transition-colors"
            >
              <VscRefresh size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close history"
              className="p-1.5 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
            >
              <VscClose size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-3">
          {error ? (
            <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300">
              Failed to load history: {error}
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center gap-2 py-12 text-gray-500 text-sm">
              <div className="w-6 h-6 border-2 border-[#3574d4] border-t-transparent rounded-full animate-spin" />
              Loading history…
            </div>
          ) : builds.length === 0 ? (
            <div className="py-12 border-2 border-dashed border-white/[0.08] rounded-xl text-center flex flex-col items-center gap-2">
              <VscHistory className="text-gray-600" size={26} />
              <p className="text-gray-400 text-sm font-medium">No builds yet</p>
              <p className="text-gray-600 text-xs">Build this environment to start a history</p>
            </div>
          ) : (
            builds.map((b, i) => (
              <BuildRow
                key={b.buildId ?? i}
                b={b}
                isCurrent={!!b.imageTag && b.imageTag === currentImage}
                deploying={deploying === b.imageTag}
                onDeploy={() => b.imageTag && handleDeploy(b.imageTag)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
