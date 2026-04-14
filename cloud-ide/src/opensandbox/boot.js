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

// 3. Idempotent Environment Setup (Skips if exists)
if (!fs.existsSync(envDir)) {
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

// 4. Boot the Server
console.log('🚀 [OpenSandbox] Booting Daemon...');
const server = spawn(serverCmd, ['--config', '.sandbox.toml'], { 
  stdio: 'inherit', 
  cwd: sandboxDir 
});

server.on('error', (err) => {
    console.error('\n❌ [OpenSandbox] Failed to start server. Ensure requirements.txt includes opensandbox.');
    console.error(err.message);
});

server.on('close', (code) => {
  console.log(`[OpenSandbox] Process exited with code ${code}`);
  process.exit(code);
});