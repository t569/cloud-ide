// Promote a sandbox into a new environment: "I installed a bunch of stuff in here —
// make it a real env I can launch again."
//
// Declarative, not a snapshot. We diff the sandbox's packages against the baseline taken
// at boot and emit an EnvironmentConfig whose buildSteps reinstall exactly that drift, on
// the SAME base image. The new env rebuilds through the normal pipeline, so it stays
// readable, diffable, and rebasable onto a patched base image.
//
// The gap is stated plainly in the UI rather than hidden: anything installed outside a
// package manager (curl | bash, a hand-edited config, a binary dropped in /usr/local/bin)
// is invisible to this and will NOT come across.
import React, { useEffect, useState } from 'react';
import { VscCloudUpload, VscWarning } from 'react-icons/vsc';
import { composePromotedConfig, type ToolDrift } from '@cloud-ide/shared/promotion';
import { getSandboxDrift } from '../api/sandbox';
import { getEnvironment, createEnvironment } from '../env-manager/services/api/environmentApi';
import { ApiError } from '../lib/apiClient';

const MANAGERS: { key: keyof ToolDrift; label: string }[] = [
  { key: 'apt', label: 'System (apt)' },
  { key: 'pip', label: 'Python (pip)' },
  { key: 'npm', label: 'Node (npm)' },
];

const countOf = (d: ToolDrift) => d.apt.length + d.pip.length + d.npm.length;

interface Props {
  sandboxId: string;
  environmentId: string;
  onDone: () => void;
  onCancel: () => void;
}

export const PromoteSandbox = ({ sandboxId, environmentId, onDone, onCancel }: Props) => {
  const [drift, setDrift] = useState<ToolDrift | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getSandboxDrift(sandboxId)
      .then(({ drift }) => live && setDrift(drift))
      .catch((e) =>
        live &&
        setError(
          e instanceof ApiError && e.status === 409
            ? e.message // no baseline — say exactly why, it isn't a crash
            : `Could not read what's installed: ${(e as Error).message}`,
        ),
      );
    return () => {
      live = false;
    };
  }, [sandboxId]);

  const save = async () => {
    if (!drift) return;
    setSaving(true);
    setError(null);
    try {
      // The source env supplies the base image, its own build steps, and its language
      // servers — all carried forward by composePromotedConfig, the same function the
      // tests pin. Promotion never edits the source: the composed config has no id.
      const source = await getEnvironment(environmentId);
      if (!source.builderConfig) {
        throw new Error('The source environment has no build config to promote from.');
      }
      await createEnvironment(composePromotedConfig(source.builderConfig, drift, name.trim()));
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const total = drift ? countOf(drift) : 0;

  return (
    <div className="mt-4 p-4 rounded-lg border border-[#5ec8d8]/30 bg-[#5ec8d8]/5">
      <p className="text-[13px] font-semibold mb-1 flex items-center gap-2">
        <VscCloudUpload className="text-[#5ec8d8]" /> Promote to a new environment
      </p>

      {!drift && !error && (
        <p className="text-[12px] text-gray-400">Reading what's installed…</p>
      )}

      {error && <p className="text-[12px] text-[#f87171] leading-relaxed">{error}</p>}

      {drift && (
        <>
          {total === 0 ? (
            <p className="text-[12px] text-gray-400 leading-relaxed">
              Nothing new has been installed since this sandbox booted — promoting it would
              just duplicate its environment.
            </p>
          ) : (
            <>
              <p className="text-[12px] text-gray-400 leading-relaxed mb-3">
                {total} package{total === 1 ? '' : 's'} installed since boot. The new
                environment keeps the same base image and reinstalls these on top, so it
                rebuilds from source.
              </p>

              <div className="space-y-2 mb-3 max-h-52 overflow-y-auto">
                {MANAGERS.filter(({ key }) => drift[key].length > 0).map(({ key, label }) => (
                  <div key={key}>
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{label}</p>
                    <div className="flex flex-wrap gap-1">
                      {drift[key].map((pkg) => (
                        <span
                          key={pkg}
                          className="px-2 py-0.5 rounded bg-[#1a1a1f] border border-white/[0.07] text-[11px] font-mono text-gray-300"
                        >
                          {pkg}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-amber-400/80 leading-relaxed mb-3 flex gap-1.5">
                <VscWarning className="mt-0.5 shrink-0" />
                <span>
                  Only what apt, pip and npm know about. Anything installed another way — a{' '}
                  <code className="font-mono">curl | bash</code>, an edited config, a binary
                  you dropped in — will not come across.
                </span>
              </p>

              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name the new environment"
                className="w-full rounded-lg bg-[#1a1a1a] border border-white/[0.07] px-3 py-2 text-[13px] text-gray-100 outline-none placeholder:text-gray-600 focus:border-[#5ec8d8]"
              />
            </>
          )}

          <div className="flex gap-2 mt-3">
            <button
              onClick={onCancel}
              disabled={saving}
              className="flex-1 text-[13px] py-2 rounded-lg border border-gray-700 bg-[#1a1a1f] hover:border-gray-500"
            >
              Cancel
            </button>
            {total > 0 && (
              <button
                onClick={save}
                disabled={saving || !name.trim()}
                className="flex-1 text-[13px] font-semibold py-2 rounded-lg border border-[#5ec8d8]/40 bg-[#5ec8d8]/15 text-[#5ec8d8] hover:border-[#5ec8d8] disabled:opacity-40"
              >
                {saving ? 'Creating…' : 'Create environment'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
