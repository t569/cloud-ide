// The "Sandbox access" sidebar pane: the owner's root password for THIS sandbox, for
// `su -` / `sudo` inside a normal (non-root) terminal. The second escalation surface
// next to the root-terminal tab — same owner-gated broker, no in-container secret.
//
// Reveal is explicit (a click), not on mount: the POST applies the password to the live
// container (mutating), and a root password shouldn't sit on-screen just because someone
// tapped the sidebar icon. The value is deterministic server-side, so re-revealing always
// shows the same password — safe to click again after a workspace restart.
import React, { useState } from 'react';
import { VscKey, VscCopy, VscCheck } from 'react-icons/vsc';
import { getSudoAccess } from '../../api/sandbox';
import { toast } from '../../notifications';

interface SandboxAccessPanelProps {
  sandboxId: string;
}

export const SandboxAccessPanel = ({ sandboxId }: SandboxAccessPanelProps) => {
  const [access, setAccess] = useState<{ user: string; password: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    setLoading(true);
    try {
      setAccess(await getSudoAccess(sandboxId));
    } catch (e) {
      toast.error((e as Error).message, { title: 'Could not get root access' });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!access) return;
    await navigator.clipboard.writeText(access.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ide-border px-3 py-2.5">
        <VscKey size={14} className="text-ide-muted" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ide-muted">
          Sandbox access
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 text-[12.5px] leading-relaxed text-ide-text">
        <p className="text-ide-muted">
          Become <span className="font-mono text-ide-text">root</span> in any terminal. Only you,
          the owner, can see this — code running inside the sandbox cannot.
        </p>

        {!access ? (
          <button
            onClick={reveal}
            disabled={loading}
            className="mt-3 w-full rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
          >
            {loading ? 'Revealing…' : 'Reveal root password'}
          </button>
        ) : (
          <>
            <div className="mt-3 rounded border border-ide-border bg-ide-bg p-2.5">
              <div className="text-[10.5px] uppercase tracking-wider text-ide-muted">Password</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ide-text">
                  {access.password}
                </code>
                <button
                  onClick={copy}
                  aria-label="Copy password"
                  className="flex-shrink-0 rounded p-1 text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text"
                >
                  {copied ? <VscCheck size={14} className="text-emerald-400" /> : <VscCopy size={14} />}
                </button>
              </div>
            </div>

            <p className="mt-3 text-[11.5px] text-ide-muted">
              In a terminal run <code className="font-mono text-ide-text">su -</code> and paste it,
              or <code className="font-mono text-ide-text">sudo &lt;command&gt;</code> if your image
              has sudo. It survives restarts.
            </p>
          </>
        )}
      </div>
    </div>
  );
};
