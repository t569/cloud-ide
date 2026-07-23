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
import { WasmDriver, moduleDirName, preopensFor } from './WasmDriver';
import { SandboxSpec } from '@cloud-ide/shared/types/sandbox';

// Regenerate: see docs/plans/wasm-runtime.md. Sections are type/import/func/memory/export/
// code/data; it imports wasi_snapshot_preview1.fd_write and exports _start + memory.
const HELLO_WASM_B64 =
  'AGFzbQEAAAABDAJgBH9/f38Bf2AAAAIjARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAADAgEB' +
  'BQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKHQEbAEEAQQg2AgBBBEENNgIAQQFBAEEBQRQQABoLCxMBAEEI' +
  'Cw1oaSBmcm9tIHdhc20K';

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
    await fs.writeFile(
      path.join(root, moduleDirName(SPEC.imageTag), 'hello.wasm'),
      Buffer.from(HELLO_WASM_B64, 'base64'),
    );
    driver = new WasmDriver(root);
  });

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
    // NOT proven here: that a guest can read/write through it. The fixture only calls
    // fd_write on stdout; proving file I/O needs a module that calls path_open, i.e. a real
    // toolchain build. First job of phase 1b — see docs/plans/wasm-runtime.md.
    const { sandboxId } = await driver.bootSandbox(spec);
    const stream = await driver.openExecStream(sandboxId, ['hello']);
    const seen = await new Promise<string>((resolve) => {
      let out = '';
      stream.on('data', (c) => { out += c; });
      stream.on('close', () => resolve(out));
    });
    expect(seen).toContain('hi from wasm');
  }, 30_000);

  it('rejects a program name that tries to escape the module directory', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    for (const bad of ['../evil', '..', 'a/b', 'C:evil']) {
      await expect(driver.execCommand(sandboxId, { command: [bad] })).rejects.toThrow(/not a valid program/);
    }
  });

  it('is honest about what preview1 cannot do, instead of inventing an endpoint', async () => {
    const { sandboxId } = await driver.bootSandbox(SPEC);
    await expect(driver.resolveEndpoint(sandboxId, 5173)).rejects.toThrow(/no sockets/);
    await expect(driver.resolveExecConnection(sandboxId)).rejects.toThrow(/no execd endpoint/);
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
