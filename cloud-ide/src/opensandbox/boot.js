// cloud-ide/src/opensandbox/boot.js
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const sandboxDir = __dirname;
const envDir = path.join(sandboxDir, 'sandbox-env');
const isWindows = os.platform() === 'win32';

// OS-specific paths for Python executables
const pythonCmd = isWindows ? 'python' : 'python3';
const serverCmd = isWindows ? path.join(envDir, 'Scripts', 'opensandbox-server') : path.join(envDir, 'bin', 'opensandbox-server');

console.log('🐳 [OpenSandbox] Initializing environment...');

// 1. Verify Docker is running
try {
  execSync('docker info', { stdio: 'ignore' });
} catch (error) {
  console.error('\n❌ [OpenSandbox] ERROR: Docker is not running!');
  console.error('👉 Please start Docker Desktop and run this command again.\n');
  process.exit(1);
}

// 2. Ensure `uv` is installed
let uvCmd = 'uv';
try {
  execSync(`${uvCmd} --version`, { stdio: 'ignore' });
  console.log('⚡ [OpenSandbox] uv is ready.');
} catch (error) {
  console.log('📦 [OpenSandbox] uv not found system-wide. Installing via pip...');
  // Install uv via Python's package manager; Install for the user (mac is weird lol)
  execSync(`${pythonCmd} -m pip install --user uv`, { stdio: 'inherit' });
  // Route commands through Python to bypass Windows PATH reload requirements
  uvCmd = `${pythonCmd} -m uv`; 
}

// 3. Idempotent Environment Setup.
// Keyed on the SERVER BINARY, not on `sandbox-env/` existing: `uv venv` creates the
// directory before `uv pip install` populates it, so an install killed in between
// (Ctrl-C, a WSL shutdown, a full disk) leaves a valid-looking venv with no server
// in it. Keyed on the directory, every later boot then skipped the install and died
// with `spawn .../opensandbox-server ENOENT`. A crashed install must not wedge the
// next one — so a half-built env is torn down and rebuilt.
if (!fs.existsSync(serverCmd)) {
  if (fs.existsSync(envDir)) {
    console.log('🧹 [OpenSandbox] Incomplete sandbox-env (no server binary). Rebuilding...');
    fs.rmSync(envDir, { recursive: true, force: true });
  }
  console.log('📦 [OpenSandbox] Virtual environment not found. Creating sandbox-env with uv...');
  execSync(`${uvCmd} venv sandbox-env`, { stdio: 'inherit', cwd: sandboxDir });

  console.log('📥 [OpenSandbox] Installing requirements.txt with uv...');
  // uv strictly requires the --python flag to target the new virtual environment
  execSync(`${uvCmd} pip install -r requirements.txt --python sandbox-env`, {
    stdio: 'inherit',
    cwd: sandboxDir
  });
} else {
  console.log('⚡ [OpenSandbox] Environment already exists. Skipping installation.');
}

// 4. Resolve the host-path allowlist.
// The daemon rejects every bind mount when `allowed_host_paths` is empty (config.py:
// "If empty, host bind mounts are rejected") — the example toml's comment claims the
// opposite. Every boot mounts a worktree, so an empty list 400s every boot. The path is
// absolute and machine-specific, so resolve it here rather than committing one dev's D:\.
// ponytail: string-replace one line, not a TOML parser — add one when a 2nd key needs it.
const worktreesRoot = path.resolve(sandboxDir, '..', 'backend', 'data', 'worktrees');
fs.mkdirSync(worktreesRoot, { recursive: true });

const resolvedConfig = path.join(sandboxDir, '.sandbox.resolved.toml');
const template = fs.readFileSync(path.join(sandboxDir, '.sandbox.toml'), 'utf8');
const allowlist = `allowed_host_paths = [${JSON.stringify(worktreesRoot.replace(/\\/g, '/'))}]`;
if (!/^allowed_host_paths\s*=/m.test(template)) {
  console.error('\n❌ [OpenSandbox] .sandbox.toml has no `allowed_host_paths` key to resolve.');
  process.exit(1);
}
fs.writeFileSync(resolvedConfig, template.replace(/^allowed_host_paths\s*=.*$/m, allowlist));
console.log(`🔓 [OpenSandbox] Bind mounts allowed under ${worktreesRoot}`);

// 5. Boot the Server
console.log('🚀 [OpenSandbox] Booting Daemon...');
// .sandbox.toml binds 127.0.0.1 with no api_key => OpenSandbox flags it "insecure"
// and won't auto-start when spawned without a TTY to confirm at (issue #750).
// This is a local-dev daemon on loopback; acknowledge and proceed non-interactively.
const server = spawn(serverCmd, ['--config', path.basename(resolvedConfig)], {
  stdio: 'inherit',
  cwd: sandboxDir,
  // MUST be uppercase "YES" — OpenSandbox compares the value verbatim (case-sensitive).
  env: { ...process.env, OPENSANDBOX_INSECURE_SERVER: 'YES' }
});

server.on('error', (err) => {
    console.error('\n❌ [OpenSandbox] Failed to start server. Ensure requirements.txt includes opensandbox.');
    console.error(err.message);
});

server.on('close', (code) => {
  console.log(`[OpenSandbox] Process exited with code ${code}`);
  process.exit(code);
});