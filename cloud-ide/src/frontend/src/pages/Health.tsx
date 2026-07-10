// The /health page. Renders GET /api/health as a card per subsystem, polling every
// 10s. Deliberately dumb: the backend decides what a subsystem is and whether it's
// healthy, so adding a probe there lights up a card here with no change to this file.
import React, { useEffect, useState } from 'react';
import { VscPulse, VscRefresh, VscServerProcess } from 'react-icons/vsc';
import type { HealthReport, HealthStatus } from '@cloud-ide/shared/types/health';
import { fetchHealth } from '../api/health';
import { navigate } from './router';

const POLL_MS = 10_000;

// Same palette as the sandbox badges: emerald live, amber wounded, red dead.
const STATUS_STYLE: Record<HealthStatus, { color: string; label: string }> = {
  ok: { color: '#34d399', label: 'Operational' },
  degraded: { color: '#fbbf24', label: 'Degraded' },
  down: { color: '#f87171', label: 'Down' },
};

const Dot = ({ status }: { status: HealthStatus }) => {
  const { color } = STATUS_STYLE[status];
  return (
    <span
      className="w-2 h-2 rounded-full shrink-0"
      style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}

export default function Health() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetchHealth()
      .then((r) => {
        setReport(r);
        setError(null);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // The gateway itself is unreachable — no report to render, so say that plainly
  // rather than showing a stale all-green board.
  const overall: HealthStatus = error ? 'down' : (report?.status ?? 'degraded');
  const { color, label } = STATUS_STYLE[overall];

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-gray-200 p-8">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <VscPulse /> System Health
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            {error
              ? 'Gateway unreachable.'
              : report
                ? `Gateway up ${formatUptime(report.uptimeSec)} · checked ${new Date(report.timestamp).toLocaleTimeString()}`
                : 'Probing subsystems…'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded border"
            style={{ color, borderColor: `${color}55` }}
          >
            <Dot status={overall} /> {label}
          </span>
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600"
          >
            <VscRefresh className={isLoading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => navigate('/sandboxes')}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-gray-800 hover:border-gray-600"
          >
            <VscServerProcess /> Sandboxes
          </button>
        </div>
      </header>

      {error && (
        <p className="text-sm text-[#f87171] mb-4">
          Could not reach the health endpoint: {error}
        </p>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {report?.checks.map((check) => (
          <div
            key={check.name}
            className="p-4 rounded-lg border bg-[#141417]"
            style={{ borderColor: `${STATUS_STYLE[check.status].color}33` }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="flex items-center gap-2 font-medium font-mono text-sm">
                <Dot status={check.status} />
                {check.name}
              </span>
              <span className="text-[11px] text-gray-600">{check.latencyMs}ms</span>
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed break-words">{check.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
