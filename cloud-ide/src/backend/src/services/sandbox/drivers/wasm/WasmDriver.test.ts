// Phase-1 acceptance criteria for the WASM tier (docs/plans/wasm-runtime.md), run against
// REAL wasm through real node:wasi — mocking the runtime would assert nothing about the one
// question phase 1 exists to answer.
//
// The fixture is a hand-assembled 141-byte WASI preview1 module (no toolchain, no download):
// it writes a message to stdout via fd_write and exits. Built by the generator kept in the
// comment below, so it can be regenerated rather than trusted as a blob.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WasmDriver, moduleDirName, preopensFor, DEFAULT_LIMITS } from './WasmDriver';
import { SandboxSpec } from '@cloud-ide/shared/types/sandbox';

// Regenerate: see docs/plans/wasm-runtime.md. Sections are type/import/func/memory/export/
// code/data; it imports wasi_snapshot_preview1.fd_write and exports _start + memory.
const HELLO_WASM_B64 =
  'AGFzbQEAAAABDAJgBH9/f38Bf2AAAAIjARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAADAgEB' +
  'BQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKHQEbAEEAQQg2AgBBBEENNgIAQQFBAEEBQRQQABoLCxMBAEEI' +
  'Cw1oaSBmcm9tIHdhc20K';

// A second hand-assembled module, and the one that matters: it calls path_open on fd 3 —
// the FIRST PREOPEN — creates `out.txt` there, writes to it, then writes path_open's errno
// to stdout as 4 raw little-endian bytes so a failure is diagnosable instead of silent.
//
// Two traps cost real time building this, both worth keeping written down:
//   - constants are SIGNED LEB128; a naive single byte silently means something else once
//     bit 6 is set (rights 0x46 decodes as negative).
//   - a rights mask of all bits (-1) is REJECTED by uvwasi with ENOTCAPABLE. A directory
//     fd can only delegate rights it holds, so ask for a realistic set.
const WRITEFILE_WASM_B64 =
  'AGFzbQEAAAABGQNgCX9/f39/fn5/fwF/YAR/f39/AX9gAAACRgIWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQlw' +
  'YXRoX29wZW4AABZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAEDAgECBQMBAAEHEwIGbWVtb3J5' +
  'AgAGX3N0YXJ0AAIKWgFYAEEQQQNBAEHAAEEHQQFCxoCAAULGgIABQQBBCBAANgIAQQBB4AA2AgBBBEEQNgIA' +
  'QQgoAgBBAEEBQQwQARpBAEEQNgIAQQRBBDYCAEEBQQBBAUEMEAEaCwskAgBBwAALB291dC50eHQAQeAACxB3' +
  'cml0dGVuIGJ5IHdhc20K';

// A module that never returns: `loop { br 0 }`, 55 bytes. Four bytes of wasm is all it
// takes to hang a sandbox forever, which is the case the wall-clock limit exists for.
const SPIN_WASM_B64 =
  'AGFzbQEAAAABBAFgAAADAgEABQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAAKCQEHAANADAALCw==';

const SPEC: SandboxSpec = { imageTag: 'demo-env:latest' };

describe('WasmDriver — phase 1', () => {
  let root: string;      // modules root
  let workspace: string; // stands in for a sandbox worktree
  let driver: WasmDriver;

  beforeEach(async () => {
    const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'wasmdrv-')));
    root = path.join(tmp, 'modules');
    workspace = path.join(tmp, 'workspace');
    await fs.mkdir(path.join(root, moduleDirName(SPEC.imageTag)), { recursive: true });
    await fs.mkdir(workspace, { recursive: true });
    const modules = path.join(root, moduleDirName(SPEC.imageTag));
    await fs.writeFile(path.join(modules, 'hello.wasm'), Buffer.from(HELLO_WASM_B64, 'base64'));
    await fs.writeFile(path.join(modules, 'writefile.wasm'), Buffer.from(WRITEFILE_WASM_B64, 'base64'));
    await fs.writeFile(path.join(modules, 'spin.wasm'), Buffer.from(SPIN_WASM_B64, 'base64'));
    driver = new WasmDriver(root);
  });

  // The shim opens a real listener on first use; leave it running and jest can't exit.
  afterEach(async () => { await driver.close(); });

  it('reports its capabilities honestly — exec yes, pty no', () => {
    expect(driver.capabilities()).toEqual({ exec: true, pty: false });
  });

  it('boots, and refuses an image whose module set is missing', async () => {
    const { sandboxId, state } = await driver.bootSandbox(SPEC);
    expect(sandboxId).toMatch(/^wsm-/);
    expect(state).toBe('RUNNING');
    await expect(driver.bootSandbox({ imageTag: 'no-such-env' })).rejects.toThrow(/No WASM modules/);
  });

  // ACCEPTANCE 2 + 5: a real module runs and its output comes back.
  it('runs a REAL wasm module and returns its stdout', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    const result = await driver.execCommand(sandboxId, { command: ['hello'] });
    expect(result.stdout).toContain('hi from wasm');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe(''); // --no-warnings: no ExperimentalWarning leaks into it
  }, 30_000);

  // ACCEPTANCE 3: instantiate-to-output is cheap. Generous bound — this catches a
  // pathological regression (a per-exec download, a sync compile of something huge),
  // not a few ms of jitter on a loaded CI box.
  it('boots and executes well inside the latency budget', async () => {
    const started = Date.now();
    const { sandboxId } = await driver.bootSandbox(SPEC);
    await driver.execCommand(sandboxId, { command: ['hello'] });
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 30_000);

  // ACCEPTANCE 1: the worktree is the guest's filesystem. A preopen is a real host dir,
  // which is the whole reason storage does not move for this tier.
  it('hands the sandbox its worktree as a WASI preopen', async () => {
    const spec: SandboxSpec = {
      ...SPEC,
      volumes: [{ name: 'w', kind: 'workspace', mountPath: '/workspace', hostPath: workspace }],
    };
    // The worktree's HOST path must reach the guest verbatim — that mapping is the whole
    // claim that storage doesn't move for this tier.
    expect(preopensFor(spec)).toEqual({ '/workspace': workspace });
    const { sandboxId } = await driver.bootSandbox(spec);
    const stream = await driver.openExecStream(sandboxId, ['hello']);
    const seen = await new Promise<string>((resolve) => {
      let out = '';
      stream.on('data', (c) => { out += c; });
      stream.on('close', () => resolve(out));
    });
    expect(seen).toContain('hi from wasm');
  }, 30_000);

  // ACCEPTANCE 1, the load-bearing one: a guest WRITES A REAL FILE into the worktree
  // through its preopen. This is what "storage does not move for this tier" means — if it
  // failed, the whole reason for choosing server-side WASM over the browser would collapse.
  it('lets a guest create a file in the worktree, visible to the host', async () => {
    const spec: SandboxSpec = {
      ...SPEC,
      volumes: [{ name: 'w', kind: 'workspace', mountPath: '/workspace', hostPath: workspace }],
    };
    const { sandboxId } = await driver.bootSandbox(spec);
    const result = await driver.execCommand(sandboxId, { command: ['writefile'] });

    expect(result.exitCode).toBe(0);
    // The guest's own view: path_open returned errno 0, as 4 little-endian bytes.
    expect(Buffer.from(result.stdout, 'binary').subarray(0, 4)).toEqual(Buffer.from([0, 0, 0, 0]));
    // The host's view: the file is simply there, no sync step, no bind mount.
    expect(await fs.readFile(path.join(workspace, 'out.txt'), 'utf8')).toBe('written by wasm\n');
  }, 30_000);

  it('confines a guest to its preopens — no preopen, no filesystem', async () => {
    // Booted with NO volumes, the same module cannot reach anything: WASI hands out no
    // ambient filesystem, which is why this tier needs no egress/nftables machinery.
    const { sandboxId } = await driver.bootSandbox(SPEC);
    const result = await driver.execCommand(sandboxId, { command: ['writefile'] });
    const errno = Buffer.from(result.stdout, 'binary').readUInt32LE(0);
    expect(errno).not.toBe(0); // EBADF — fd 3 was never granted
    await expect(fs.access(path.join(workspace, 'out.txt'))).rejects.toThrow();
  }, 30_000);

  // The whole terminal path, no fakes: real driver → real shim → real wasm, using the exact
  // request body SandboxController.ts builds (command JOINED into one shell-ish string).
  it('runs a real module through the shim over HTTP, as the controller would', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    const connection = await driver.resolveExecConnection(sandboxId);

    const response = await fetch(`${connection.baseUrl}/command`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'X-EXECD-ACCESS-TOKEN': connection.accessToken!,
      },
      body: JSON.stringify({
        command: 'export TERM=xterm-256color; hello',
        cwd: '/workspace',
        env: {},
      }),
    });

    expect(response.status).toBe(200);
    const events = (await response.text()).trim().split('\n').map((l) => JSON.parse(l));
    expect(events).toContainEqual({ type: 'stdout', text: 'hi from wasm' });
  }, 30_000);

  // ── Resource limits ───────────────────────────────────────────────────────
  // Without these a guest is bounded by nothing, and two of the three failure modes take
  // down the GATEWAY rather than the sandbox.

  it('kills a guest that runs past the time limit, and says so', async () => {
    const limited = new WasmDriver(root, { ...DEFAULT_LIMITS, timeoutMs: 400 });
    const { sandboxId } = await limited.bootSandbox(SPEC);

    const started = Date.now();
    const result = await limited.execCommand(sandboxId, { command: ['spin'] });

    // Really killed, not merely reported: `spin` never returns on its own.
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result.stderr).toMatch(/killed: exceeded the 400 ms time limit/);
    await limited.close();
  }, 30_000);

  it('kills a guest that floods output — the gateway buffers it, so this is a server DoS', async () => {
    // 'hi from wasm\n' is 13 bytes; a 4-byte budget is exceeded by the first chunk.
    const limited = new WasmDriver(root, { ...DEFAULT_LIMITS, maxOutputBytes: 4 });
    const { sandboxId } = await limited.bootSandbox(SPEC);

    const result = await limited.execCommand(sandboxId, { command: ['hello'] });
    expect(result.stderr).toMatch(/killed: produced more than 4 bytes/);
    // The over-budget chunk is dropped rather than buffered — that's the point.
    expect(result.stdout).not.toContain('hi from wasm');
    await limited.close();
  }, 30_000);

  it('leaves a well-behaved guest completely alone', async () => {
    // The limits must not be visible to anything that stays inside them.
    const result = await driver.execCommand(
      (await driver.bootSandbox(SPEC)).sandboxId,
      { command: ['hello'] },
    );
    expect(result.stdout).toContain('hi from wasm');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  }, 30_000);

  it('applies the same limits to the terminal path, not just execCommand', async () => {
    const limited = new WasmDriver(root, { ...DEFAULT_LIMITS, timeoutMs: 400 });
    const { sandboxId } = await limited.bootSandbox(SPEC);

    const lines: string[] = [];
    await limited.execLines(sandboxId, ['spin'], undefined, (_t, text) => lines.push(text));
    expect(lines.join('\n')).toMatch(/killed: exceeded the 400 ms time limit/);
    await limited.close();
  }, 30_000);

  it('rejects a program name that tries to escape the module directory', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    for (const bad of ['../evil', '..', 'a/b', 'C:evil']) {
      await expect(driver.execCommand(sandboxId, { command: [bad] })).rejects.toThrow(/not a valid program/);
    }
  });

  it('is honest about what preview1 cannot do, instead of inventing an endpoint', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    // Still true, and the one thing moving to wasmtime buys.
    await expect(driver.resolveEndpoint(sandboxId, 5173)).rejects.toThrow(/no sockets/);
  });

  it('serves exec over a loopback execd shim, started on first use', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    const connection = await driver.resolveExecConnection(sandboxId);
    expect(connection.baseUrl).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+/${sandboxId}$`));
    expect(connection.accessToken).toEqual(expect.any(String));
    await expect(driver.resolveExecConnection('wsm-nope')).rejects.toThrow(/Unknown sandbox/);
  });

  // ACCEPTANCE 6: teardown leaves nothing behind.
  it('destroys a sandbox and forgets it', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    expect(await driver.destroySandbox(sandboxId)).toBe(true);
    expect((await driver.getSandboxStatus(sandboxId)).state).toBe('STOPPED');
    expect(await driver.destroySandbox(sandboxId)).toBe(false); // idempotent, not a throw
    await expect(driver.execCommand(sandboxId, { command: ['hello'] })).rejects.toThrow(/Unknown sandbox/);
  });

  it('pauses and resumes as bookkeeping (an idle wasm sandbox holds no process)', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    expect(await driver.pauseSandbox(sandboxId)).toBe(true);
    expect((await driver.getSandboxStatus(sandboxId)).state).toBe('PAUSED');
    expect(await driver.resumeSandbox(sandboxId)).toBe(true);
    expect((await driver.getSandboxStatus(sandboxId)).state).toBe('RUNNING');
  });

  it('folds an image tag into one safe path segment', () => {
    expect(moduleDirName('demo-env:latest')).toBe('demo-env_latest');
    expect(() => moduleDirName('../../etc')).toThrow();
    expect(() => moduleDirName('')).toThrow();
  });
});
