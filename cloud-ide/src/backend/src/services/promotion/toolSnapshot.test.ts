// Self-check for env-promotion's detector. What can actually go wrong: mis-parsing a
// package manager's output (a bad buildStep that fails the promoted build), or a diff
// that reports the base image's own packages as "yours" (an env that reinstalls the world).
import {
  parseApt,
  parsePip,
  parseNpm,
  diffSnapshots,
  captureSnapshot,
  PROBES,
} from './toolSnapshot';

describe('package-manager parsers', () => {
  it('takes installed apt packages and ignores deinstalled ones', () => {
    const out = ['libc6\t\t\t\t\tinstall', 'libpq-dev\t\t\t\tinstall', 'oldpkg\t\t\t\tdeinstall', ''].join('\n');
    expect(parseApt(out)).toEqual(['libc6', 'libpq-dev']);
  });

  it('takes pinned pip packages and drops editable installs', () => {
    // "-e git+https://..." has no version to pin, so it cannot become a buildStep.
    const out = 'numpy==2.1.0\npandas==2.2.3\n-e git+https://github.com/x/y.git#egg=y\n\n';
    expect(parsePip(out)).toEqual(['numpy==2.1.0', 'pandas==2.2.3']);
  });

  it('takes global npm packages, and survives non-JSON output', () => {
    const out = JSON.stringify({
      name: 'lib',
      dependencies: { typescript: { version: '5.5.4' }, corepack: { version: '0.29.0' } },
    });
    expect(parseNpm(out).sort()).toEqual(['corepack@0.29.0', 'typescript@5.5.4']);

    // Some npm versions print a warning banner instead of JSON. That's no data, not a crash.
    expect(parseNpm('npm WARN config global ...')).toEqual([]);
  });
});

describe('diffSnapshots', () => {
  it('reports only what was added after boot', () => {
    const base = { apt: ['libc6'], pip: ['pip==24.0'], npm: ['npm@10.8.2'] };
    const current = {
      apt: ['libc6', 'libpq-dev'],
      pip: ['pip==24.0', 'numpy==2.1.0'],
      npm: ['npm@10.8.2', 'typescript@5.5.4'],
    };

    // The base image's own packages must NOT appear, or the promoted env would reinstall
    // everything the image already ships.
    expect(diffSnapshots(base, current)).toEqual({
      apt: ['libpq-dev'],
      pip: ['numpy==2.1.0'],
      npm: ['typescript@5.5.4'],
    });
  });

  it('treats an upgrade as an addition, pinning what the sandbox actually has', () => {
    const drift = diffSnapshots({ ...empty, pip: ['numpy==2.0.0'] }, { ...empty, pip: ['numpy==2.1.0'] });
    expect(drift.pip).toEqual(['numpy==2.1.0']);
  });

  const empty = { apt: [], pip: [], npm: [] };
  it('is empty for an untouched sandbox', () => {
    const same = { apt: ['libc6'], pip: [], npm: [] };
    expect(diffSnapshots(same, same)).toEqual(empty);
  });
});

describe('captureSnapshot', () => {
  it('probes each manager with shell-metacharacter-free argv', () => {
    // execd joins argv into ONE string and hands it to a shell, so a `${...}` or `;` in a
    // probe would be interpreted rather than passed through.
    for (const probe of Object.values(PROBES)) {
      expect(probe.join(' ')).not.toMatch(/[$;&|`<>()]/);
    }
  });

  it('treats a missing package manager as an absence, not a failure', async () => {
    // A node image has no pip: that probe exits non-zero. The others must still count.
    const exec = jest.fn(async (command: string[]) => {
      if (command[0] === 'pip') return { stdout: 'pip: not found', stderr: '', exitCode: 127 };
      if (command[0] === 'dpkg') return { stdout: 'libc6\tinstall', stderr: '', exitCode: 0 };
      throw new Error('npm exploded'); // and a thrown probe must not sink the rest
    });

    expect(await captureSnapshot(exec)).toEqual({ apt: ['libc6'], pip: [], npm: [] });
  });
});
