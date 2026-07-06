import React, { useEffect, useRef, useState } from 'react';
import type { IconType } from 'react-icons';
import { VscClose, VscTerminal, VscLoading, VscPass, VscError, VscStopCircle } from 'react-icons/vsc';
import { TerminalComponent, TerminalHandle } from '@frontend/terminal/components/Terminal';
import { toast } from '@frontend/notifications';
import { BuildStreamTransport } from '../services/BuildStreamTransport';
import { BaseImageIcon } from './icons/BaseImageIcon';
import { SavedEnvironment, getBuildStatus, cancelBuild } from '../services/api/environmentApi';

type Status = 'building' | 'done' | 'error' | 'cancelled';

const STATUS_META: Record<Status, { color: string; label: string; Icon: IconType }> = {
  building: { color: '#fbbf24', label: 'Building…', Icon: VscLoading },
  done: { color: '#34d399', label: 'Stream finished', Icon: VscPass },
  error: { color: '#f87171', label: 'Build request failed', Icon: VscError },
  cancelled: { color: '#fbbf24', label: 'Cancelled', Icon: VscStopCircle },
};

export const BuildLogModal = ({ env, onClose }: { env: SavedEnvironment; onClose: () => void }) => {
  const terminalRef = useRef<TerminalHandle>(null);
  const transport = useRef(new BuildStreamTransport()).current;
  const cancelledRef = useRef(false);
  const [status, setStatus] = useState<Status>('building');
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    transport.onError(() => {
      if (!cancelledRef.current) setStatus('error');
    });
    transport.startBuild(env.id).finally(async () => {
      if (cancelledRef.current) {
        setStatus('cancelled');
        return;
      }
      // The stream is plain text; ask the backend for the authoritative outcome.
      try {
        const state = await getBuildStatus(env.id);
        setStatus((s) => (s === 'error' ? s : state.status === 'failed' ? 'error' : 'done'));
      } catch {
        setStatus((s) => (s === 'error' ? s : 'done'));
      }
    });
    return () => transport.disconnect();
  }, [transport, env.id]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCancel = () => {
    cancelledRef.current = true;
    setCancelling(true);
    // Tells the backend to kill docker; the open stream then ends on its own.
    cancelBuild(env.id).catch((e) => toast.error((e as Error).message, { title: 'Cancel failed' }));
  };

  const meta = STATUS_META[status];
  const name = env.builderConfig?.name || env.id;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[900px] rounded-xl bg-[#1c1c1c] border border-white/[0.08] shadow-2xl overflow-hidden flex flex-col animate-fade-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-gradient-to-b from-[#2d2d2d] to-[#262626] border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <VscTerminal className="text-[#3574d4] flex-shrink-0" size={17} />
            <div className="flex items-center gap-2 min-w-0">
              <BaseImageIcon imageName={env.builderConfig?.baseImage ?? ''} size={18} />
              <span className="text-sm font-semibold text-gray-100 truncate">Build · {name}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: meta.color }}>
              <meta.Icon size={13} className={status === 'building' ? 'animate-spin' : ''} />
              {meta.label}
            </span>

            {status === 'building' && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md border border-red-500/40 text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors active:scale-95 disabled:opacity-50"
              >
                <VscStopCircle size={13} />
                {cancelling ? 'Cancelling…' : 'Cancel'}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close build logs"
              className="p-1 rounded text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
            >
              <VscClose size={16} />
            </button>
          </div>
        </div>

        {/* Terminal */}
        <div className="h-[460px] bg-[#0e0e0e]">
          <TerminalComponent ref={terminalRef} theme="dark" isReadOnly transport={transport} />
        </div>
      </div>
    </div>
  );
};
