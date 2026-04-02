// cloud-ide/opensandbox/boot-engine.js
const { execSync, spawn } = require('child_process');
const os = require('os');
const path = require('path');

console.log('\x1b[36m[Bootstrapper]\x1b[0m Initializing OpenSandbox Environment...');

// 1. OS-Specific Configurations
const isWindows = os.platform() === 'win32';
const isMac = os.platform() === 'darwin';

// Path to the Python executable inside your virtual environment
const pythonExecutable = isWindows 
  ? path.join(__dirname, 'sandbox-env', 'Scripts', 'python.exe')
  : path.join(__dirname, 'sandbox-env', 'bin', 'python');

const serverExecutable = isWindows
  ? path.join(__dirname, 'sandbox-env', 'Scripts', 'opensandbox-server.exe')
  : path.join(__dirname, 'sandbox-env', 'bin', 'opensandbox-server');

// 2. Function to check if Docker is running
function isDockerRunning() {
  try {
    execSync('docker ps', { stdio: 'ignore' });
    return true;
  } catch (err) {
    return false;
  }
}

// 3. Function to start Docker based on the OS
function startDocker() {
  console.log('\x1b[33m[Bootstrapper]\x1b[0m Docker is not running. Attempting to start Docker daemon...');
  
  try {
    if (isWindows) {
      execSync('start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"');
    } else if (isMac) {
      execSync('open -a Docker');
    } else {
      // Linux Server Environment
      execSync('sudo systemctl start docker');
    }
  } catch (err) {
    console.error('\x1b[31m[Error]\x1b[0m Failed to start Docker. Please start it manually.');
    process.exit(1);
  }
}

// --- MAIN EXECUTION ---

// Step A: Ensure Docker is alive
if (!isDockerRunning()) {
  startDocker();
  
  // Poll every 2 seconds until Docker answers
  console.log('\x1b[36m[Bootstrapper]\x1b[0m Waiting for Docker Engine to wake up...');
  while (!isDockerRunning()) {
    execSync(isWindows ? 'timeout /t 2 >nul' : 'sleep 2');
  }
}
console.log('\x1b[32m[Bootstrapper]\x1b[0m Docker Engine is ONLINE.');

// Step B: Generate the dynamic .sandbox.toml for this specific machine
console.log('\x1b[36m[Bootstrapper]\x1b[0m Generating localized OpenSandbox configuration...');
try {
  execSync(`"${serverExecutable}" init-config .sandbox.toml --example docker --force`, { 
    cwd: __dirname, 
    stdio: 'inherit' 
  });
  
  // Dynamically resolve the absolute path so the user knows exactly where it lives
  const configPath = path.join(__dirname, '.sandbox.toml');
  
  // \x1b[35m makes the path magenta so it stands out in the terminal
  console.log(`\x1b[32m[Bootstrapper]\x1b[0m Configuration generated successfully at: \x1b[35m${configPath}\x1b[0m`);
} catch (err) {
  console.error('\x1b[31m[Error]\x1b[0m Failed to generate .sandbox.toml', err.message);
  process.exit(1);
}

// Step C: Start the OpenSandbox Server
console.log('\x1b[36m[Bootstrapper]\x1b[0m Launching OpenSandbox API Engine...\n');
const serverProcess = spawn(serverExecutable, ['--config', '.sandbox.toml'], {
  cwd: __dirname,
  stdio: 'inherit' // This pipes the Python logs directly into your Node console
});

serverProcess.on('close', (code) => {
  console.log(`\x1b[33m[Bootstrapper]\x1b[0m Engine shut down with code ${code}`);
});