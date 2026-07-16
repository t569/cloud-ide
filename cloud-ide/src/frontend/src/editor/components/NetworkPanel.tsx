// The "Allowed Hosts" sidebar pane: what this sandbox may reach (its egress
// allow-list) and an editor for the env's own domains. Reads the LIVE policy from
// GET /v1/sandboxes/:id/network; writes go to the environment's allowedDomains via
// the existing env-manager API. Policy is applied at container-create, so a change
// here takes effect on the next restart of the workspace — the panel shows those
// as "on restart" rather than pretending they're live.
import React, { useEffect, useState } from 'react';
import { VscAdd, VscClose } from 'react-icons/vsc';
import { getSandboxNetwork, listSandboxes } from '../../api/sandbox';
import { EditorEventBus } from '../core/EditorEventBus';
import {
  getEnvironment,
  updateEnvironment,
  SavedEnvironment,
} from '../../env-manager/services/api/environmentApi';
import { normalizeDomain } from '../../env-manager/utils/domain';
import { toast } from '../../notifications';
import type { NetworkPolicySpec } from '@cloud-ide/shared/types/sandbox';
import { classifyDomains } from './networkDomains';

interface NetworkPanelProps {
  sandboxId: string;
  eventBus: EditorEventBus;
}

export const NetworkPanel = ({ sandboxId, eventBus }: NetworkPanelProps) => {
  const [enforced, setEnforced] = useState<boolean | null>(null);
  const [policy, setPolicy] = useState<NetworkPolicySpec | null>(null);
  const [env, setEnv] = useState<SavedEnvironment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const net = await getSandboxNetwork(sandboxId);
        if (!live) return;
        setEnforced(net.enforced);
        setPolicy(net.policy);

        // The status route doesn't carry environmentId; the owner's sandbox list does.
        const mine = await listSandboxes();
        const envId = mine.find((s) => s.sandboxId === sandboxId)?.environmentId;
        if (envId) {
          const record = await getEnvironment(envId);
          if (live) setEnv(record);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [sandboxId]);

  const envDomains = env?.builderConfig?.allowedDomains ?? [];
  const groups = classifyDomains(policy, envDomains);

  const saveDomains = async (next: string[]) => {
    if (!env?.builderConfig) return;
    setSaving(true);
    try {
      const { environment } = await updateEnvironment(env.id, {
        ...env.builderConfig,
        allowedDomains: next,
      });
      setEnv(environment);
      toast.success('Allowed hosts updated — applies the next time this workspace restarts.', {
        title: 'Network access',
      });
    } catch (e) {
      toast.error((e as Error).message, { title: 'Could not update allowed hosts' });
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const d = normalizeDomain(draft);
    setDraft('');
    if (!d || envDomains.includes(d)) return; // blank or dupe: nothing to do
    saveDomains([...envDomains, d]);
  };

  const remove = (d: string) => saveDomains(envDomains.filter((x) => x !== d));

  // Policy binds at container-create, so pending hosts need a container swap.
  // One workspace-restart handler lives in EditorWorkspace (confirm + flush +
  // navigate-to-new-id); this button is just a second entry point to it.
  const restart = () => eventBus.emit('WORKSPACE_RESTART_REQUESTED', {});

  const row = (d: string, opts: { removable?: boolean; pending?: boolean } = {}) => (
    <div
      key={d}
      className="group flex items-center justify-between rounded px-2 py-1 text-[12.5px] hover:bg-ide-hover"
    >
      <span className="truncate font-mono text-ide-text">{d}</span>
      <span className="ml-2 flex flex-shrink-0 items-center gap-1.5">
        {opts.pending && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
            on restart
          </span>
        )}
        {opts.removable && (
          <button
            aria-label={`Remove ${d}`}
            disabled={saving}
            onClick={() => remove(d)}
            className="rounded p-0.5 text-ide-muted opacity-0 transition-opacity hover:bg-ide-border hover:text-ide-text group-hover:opacity-100"
          >
            <VscClose size={13} />
          </button>
        )}
      </span>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ide-border px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ide-muted">
          Allowed Hosts
        </span>
        {enforced !== null && (
          <span
            title={
              enforced
                ? 'Deny-default egress is enforced: only the hosts below are reachable.'
                : 'This host cannot run the egress sidecar — the policy below is what WOULD apply.'
            }
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              enforced ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
            }`}
          >
            {enforced ? 'enforced' : 'not enforced'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {error && <p className="px-2 text-[12px] text-red-400">{error}</p>}

        {/* The env's own domains — editable. */}
        <p className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-ide-muted">
          This environment
        </p>
        {envDomains.length === 0 && (
          <p className="px-2 pb-1 text-[11.5px] italic text-ide-muted">
            No custom hosts yet — add one below.
          </p>
        )}
        {groups.active.map((d) => row(d, { removable: true }))}
        {groups.pending.map((d) => row(d, { removable: true, pending: true }))}

        {/* Pending hosts only bind on a fresh container — offer the swap in one click. */}
        {groups.pending.length > 0 && (
          <button
            onClick={restart}
            className="mx-2 mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11.5px] text-amber-300 transition-colors hover:bg-amber-500/20"
          >
            Restart workspace to apply
          </button>
        )}

        {/* Built-ins: registries + GitHub, derived from the env's toolchain. */}
        {groups.builtin.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-ide-muted">
              Built-in (registries &amp; GitHub)
            </p>
            {groups.builtin.map((d) => row(d))}
          </>
        )}
      </div>

      {/* Add row */}
      <div className="border-t border-ide-border p-2">
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="api.example.com or *.example.com"
            disabled={!env || saving}
            className="min-w-0 flex-1 rounded border border-ide-border bg-ide-bg px-2 py-1 text-[12px] text-ide-text outline-none placeholder:text-ide-muted focus:border-ide-accent"
          />
          <button
            onClick={add}
            disabled={!env || saving}
            aria-label="Add host"
            className="rounded border border-ide-border px-2 text-ide-muted transition-colors hover:bg-ide-hover hover:text-ide-text disabled:opacity-40"
          >
            <VscAdd size={14} />
          </button>
        </div>
        <p className="pt-1.5 text-[10.5px] leading-snug text-ide-muted">
          Everything not listed is blocked. Changes apply when the workspace next restarts.
        </p>
      </div>
    </div>
  );
};
