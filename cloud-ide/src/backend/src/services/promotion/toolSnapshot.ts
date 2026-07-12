// backend/src/services/promotion/toolSnapshot.ts
//
// What is installed in a sandbox, per package manager — the raw material for
// env-promotion ("turn what I installed into a new environment").
//
// A BASELINE is taken at boot, before the user has touched anything, and stored on the
// SandboxRecord. DRIFT is then just `current - baseline`: exact, cheap, and computable
// later without re-inspecting the base image. That is the whole trick — the alternative
// (introspecting the image on demand) needs a throwaway container and gets stale.
//
// LIMIT, and it is a real one: this only sees what the package managers know. A
// `curl | bash` install, a hand-edited config, a binary dropped in /usr/local/bin — none
// of it shows up. Promotion surfaces that gap to the user rather than pretending
// the result is a faithful copy of the sandbox.
//
// ponytail: three package managers (apt/pip/npm) because that is what BuildStep already
// speaks. Add cargo/gem/go when an env actually needs one.
import { SandboxExecResult } from '@cloud-ide/shared';

export interface ToolSnapshot {
  apt: string[]; // package names ("libpq-dev") — BuildStep's apt takes bare names
  pip: string[]; // "numpy==2.1.0"
  npm: string[]; // "typescript@5.5.4"
}

export const EMPTY_SNAPSHOT: ToolSnapshot = { apt: [], pip: [], npm: [] };

/**
 * The probes. Deliberately free of shell metacharacters: execd joins argv into a single
 * string and hands it to a shell, so a `${...}` or `;` in here would be interpreted
 * rather than passed through. Keep these boring.
 */
export const PROBES = {
  apt: ['dpkg', '--get-selections'],
  pip: ['pip', 'freeze'],
  npm: ['npm', 'ls', '-g', '--depth=0', '--json'],
} as const;

/** `dpkg --get-selections` → "libc6\t\t\tinstall". Ignore anything not installed. */
export function parseApt(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([name, status]) => name && status === 'install')
    .map(([name]) => name);
}

/** `pip freeze` → "numpy==2.1.0". Editable installs ("-e git+...") aren't reproducible
 *  as a package name, so they're dropped rather than emitted as a broken buildStep. */
export function parsePip(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('-') && l.includes('=='));
}

/** `npm ls -g --json` → {dependencies:{name:{version}}}. Bad JSON = no data, not a crash:
 *  npm prints warnings to stdout in some versions. */
export function parseNpm(stdout: string): string[] {
  try {
    const deps = JSON.parse(stdout)?.dependencies ?? {};
    return Object.entries(deps)
      .filter(([, v]: [string, any]) => v?.version)
      .map(([name, v]: [string, any]) => `${name}@${v.version}`);
  } catch {
    return [];
  }
}

/** Everything in `current` that wasn't in `base` — what the user actually added.
 *  An upgraded package reads as added (its version string changed), which is right:
 *  the promoted env should pin what the sandbox actually has. */
export function diffSnapshots(base: ToolSnapshot, current: ToolSnapshot): ToolSnapshot {
  const added = (b: string[], c: string[]) => {
    const seen = new Set(b);
    return c.filter((item) => !seen.has(item));
  };
  return {
    apt: added(base.apt, current.apt),
    pip: added(base.pip, current.pip),
    npm: added(base.npm, current.npm),
  };
}

export const isEmptySnapshot = (s: ToolSnapshot): boolean =>
  s.apt.length === 0 && s.pip.length === 0 && s.npm.length === 0;

/**
 * Run the probes in a sandbox. A missing package manager (no pip in a node image) exits
 * non-zero — that's an absence, not a failure, so it yields an empty list and the other
 * probes still count.
 */
export async function captureSnapshot(
  exec: (command: string[]) => Promise<SandboxExecResult>,
): Promise<ToolSnapshot> {
  const probe = async (command: string[], parse: (s: string) => string[]): Promise<string[]> => {
    try {
      const { stdout, exitCode } = await exec(command);
      return exitCode === 0 ? parse(stdout) : [];
    } catch {
      return []; // sandbox gone, driver hiccup — a partial snapshot beats none
    }
  };

  const [apt, pip, npm] = await Promise.all([
    probe([...PROBES.apt], parseApt),
    probe([...PROBES.pip], parsePip),
    probe([...PROBES.npm], parseNpm),
  ]);
  return { apt, pip, npm };
}
