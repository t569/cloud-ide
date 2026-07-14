import React, { useMemo, useState } from 'react';
import { VscSearch, VscTrash, VscAdd, VscRefresh, VscServerEnvironment, VscPlay, VscLoading, VscHistory, VscRocket } from 'react-icons/vsc';
import { BaseImageIcon } from './icons/BaseImageIcon';
import { SavedEnvironment, BuildState } from '../services/api/environmentApi';
import { useBuildStatuses } from '../hooks/useBuildStatuses';
import { timeAgo } from '../utils/timeAgo';

interface MyEnvironmentsProps {
  environments: SavedEnvironment[];
  isLoading: boolean;
  error: string | null;
  selectedId: string | null;
  onOpen: (env: SavedEnvironment) => void;
  onBuild: (env: SavedEnvironment) => void;
  /** `fresh` = a NEW workspace on this image, instead of reusing the one I have. */
  onLaunch: (env: SavedEnvironment, fresh?: boolean) => void;
  onHistory: (env: SavedEnvironment) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  onRefresh: () => void;
}

// Live build status wins; otherwise fall back to whether an image was ever built.
const StatusBadge = ({ env, live }: { env: SavedEnvironment; live?: BuildState }) => {
  let color = '#fbbf24';
  let label = 'Draft';
  let building = false;

  if (live?.status === 'queued') {
    color = '#fbbf24';
    label = 'Queued';
  } else if (live?.status === 'building') {
    color = '#fbbf24';
    label = 'Building';
    building = true;
  } else if (live?.status === 'failed') {
    color = '#f87171';
    label = 'Build failed';
  } else if (live?.status === 'succeeded' || env.imageName) {
    color = '#34d399';
    label = 'Built';
  }

  return (
    <span className="flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap" style={{ color }}>
      {building ? (
        <VscLoading size={11} className="animate-spin" />
      ) : (
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
      )}
      {label}
    </span>
  );
};

const EnvCard = ({
  env,
  live,
  selected,
  onOpen,
  onBuild,
  onLaunch,
  onHistory,
  onDelete,
}: {
  env: SavedEnvironment;
  live?: BuildState;
  selected: boolean;
  onOpen: () => void;
  onBuild: () => void;
  onLaunch: (fresh?: boolean) => void;
  onHistory: () => void;
  onDelete: () => void;
}) => {
  const cfg = env.builderConfig;
  const stepCount = cfg?.buildSteps?.length ?? 0;
  // Launch needs a built image; live-succeeded also counts before the list refetches.
  const built = !!env.imageName || live?.status === 'succeeded';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group w-full text-left p-4 rounded-xl border transition-all animate-fade-up ${
        selected
          ? 'border-[#3574d4] bg-[#3574d4]/[0.08] ring-1 ring-[#3574d4]/40'
          : 'border-white/[0.06] bg-[#1f1f1f] hover:border-white/[0.14] hover:bg-[#232323]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-[#161616] rounded-lg ring-1 ring-white/[0.06] flex-shrink-0">
          <BaseImageIcon imageName={cfg?.baseImage ?? ''} size={28} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-100 truncate">{cfg?.name || env.id}</h3>
            <StatusBadge env={env} live={live} />
          </div>
          <p className="text-[11px] text-gray-500 font-jetbrains truncate">{env.id}</p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-white/[0.05] grid grid-cols-2 gap-y-1.5 text-[11px] font-jetbrains">
        <span className="text-gray-500">Base</span>
        <span className="text-gray-300 truncate text-right">{cfg?.baseImage || '—'}</span>
        <span className="text-gray-500">Steps</span>
        <span className="text-gray-300 text-right">{stepCount}</span>
        <span className="text-gray-500">Created</span>
        <span className="text-gray-300 text-right">{timeAgo(env.createdAt)}</span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="flex-1 text-center text-[11px] font-sans font-medium text-[#5a9cf8] bg-[#3574d4]/10 border border-[#3574d4]/20 rounded-md py-1.5 group-hover:bg-[#3574d4]/20 transition-colors">
          Open in Architect
        </span>
        <span
          role="button"
          tabIndex={built ? 0 : -1}
          aria-label={built ? `Launch ${env.id} in editor` : `Build ${env.id} before launching`}
          aria-disabled={!built}
          title={built ? 'Launch in editor' : 'Build this environment first'}
          onClick={(e) => {
            e.stopPropagation();
            if (built) onLaunch();
          }}
          className={`flex items-center gap-1 text-[11px] font-sans font-medium rounded-md px-2.5 py-1.5 transition-colors ${
            built
              ? 'text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 cursor-pointer'
              : 'text-gray-600 bg-white/[0.02] border border-white/[0.06] cursor-not-allowed'
          }`}
        >
          <VscRocket size={12} />
          Launch
        </span>
        <span
          role="button"
          tabIndex={built ? 0 : -1}
          aria-label={
            built ? `New workspace on ${env.id}` : `Build ${env.id} before creating a workspace`
          }
          aria-disabled={!built}
          title={
            built
              ? 'New workspace on this image (Launch reuses the one you have)'
              : 'Build this environment first'
          }
          onClick={(e) => {
            e.stopPropagation();
            if (built) onLaunch(true);
          }}
          className={`flex items-center text-[11px] font-sans font-medium rounded-md px-2 py-1.5 transition-colors ${
            built
              ? 'text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 cursor-pointer'
              : 'text-gray-600 bg-white/[0.02] border border-white/[0.06] cursor-not-allowed'
          }`}
        >
          <VscAdd size={12} />
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label={`Build ${env.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onBuild();
          }}
          className="flex items-center gap-1 text-[11px] font-sans font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-md px-2.5 py-1.5 hover:bg-emerald-500/20 transition-colors"
        >
          <VscPlay size={12} />
          Build
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label={`Build history for ${env.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onHistory();
          }}
          className="p-1.5 rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
        >
          <VscHistory size={15} />
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label={`Delete ${env.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
        >
          <VscTrash size={15} />
        </span>
      </div>
    </button>
  );
};

export const MyEnvironments = ({
  environments,
  isLoading,
  error,
  selectedId,
  onOpen,
  onBuild,
  onLaunch,
  onHistory,
  onDelete,
  onCreateNew,
  onRefresh,
}: MyEnvironmentsProps) => {
  const [query, setQuery] = useState('');
  const statuses = useBuildStatuses(); // live { envId -> BuildState }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...environments].sort((a, b) => b.createdAt - a.createdAt);
    if (!q) return sorted;
    return sorted.filter(
      (e) => e.id.toLowerCase().includes(q) || (e.builderConfig?.name ?? '').toLowerCase().includes(q),
    );
  }, [environments, query]);

  return (
    <div className="w-[320px] flex-shrink-0 flex flex-col gap-4 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-50">My Environments</h1>
          <p className="text-gray-500 text-sm mt-0.5">Saved build blueprints</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh environments"
          className="p-2 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-white/[0.06] transition-colors"
        >
          <VscRefresh size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-3 transition-all focus-within:border-[#3574d4] focus-within:ring-2 focus-within:ring-[#3574d4]/25">
        <VscSearch className="text-gray-500 flex-shrink-0" size={15} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search environments..."
          className="w-full py-2 bg-transparent text-sm text-gray-200 outline-none placeholder:text-gray-600"
        />
      </div>

      {/* List */}
      <div className="flex flex-col gap-3 overflow-y-auto max-h-[calc(100vh-16rem)] scrollbar-thin pr-1">
        {error ? (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-300">
            Failed to load environments: {error}
          </div>
        ) : isLoading ? (
          <div className="flex flex-col items-center gap-2 py-12 text-gray-500 text-sm">
            <div className="w-6 h-6 border-2 border-[#3574d4] border-t-transparent rounded-full animate-spin" />
            Loading environments...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 border-2 border-dashed border-white/[0.08] rounded-xl text-center flex flex-col items-center gap-2">
            <VscServerEnvironment className="text-gray-600" size={26} />
            <p className="text-gray-400 text-sm font-medium">
              {query ? 'No matches' : 'No saved environments yet'}
            </p>
            {!query && <p className="text-gray-600 text-xs">Export one from the Architect to see it here</p>}
          </div>
        ) : (
          filtered.map((env) => (
            <EnvCard
              key={env.id}
              env={env}
              live={statuses[env.id]}
              selected={env.id === selectedId}
              onOpen={() => onOpen(env)}
              onBuild={() => onBuild(env)}
              onLaunch={(fresh) => onLaunch(env, fresh)}
              onHistory={() => onHistory(env)}
              onDelete={() => onDelete(env.id)}
            />
          ))
        )}
      </div>

      <button
        type="button"
        onClick={onCreateNew}
        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-gray-200 text-sm font-medium transition-all active:scale-[0.98]"
      >
        <VscAdd size={14} />
        Create New Environment
      </button>
    </div>
  );
};
