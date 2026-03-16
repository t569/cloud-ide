
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const DB_FILE = path.join(__dirname, 'environments.json');

// --- DATABASE API ---
const getEnvironments = () => {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
};

app.get('/api/environments', (req, res) => res.json(getEnvironments()));

app.post('/api/environments', (req, res) => {
  const newEnv = req.body;
  const db = getEnvironments();
  newEnv.id = Date.now().toString(); 
  db.push(newEnv);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  res.json({ success: true, environment: newEnv });
});

// --- DOCKERFILE GENERATOR ---
const generateDockerfile = (config) => {
  let df = `FROM ${config.base}\n`;
  
  // Prevent interactive prompts from freezing the build (e.g., timezone selections)
  df += `ENV DEBIAN_FRONTEND=noninteractive\n`;

  // 1. Install System Packages
  if (config.packages.system.length > 0) {
    const sysPkgs = config.packages.system.map(p => p.name).join(' ');
    df += `RUN apt-get update && apt-get install -y ${sysPkgs}\n`;
  }

  // 2. Install Language Packages
  if (config.packages.language.length > 0) {
    if (config.base.includes('python')) {
      const pipPkgs = config.packages.language.map(p => p.version !== 'latest' ? `${p.name}==${p.version}` : p.name).join(' ');
      df += `RUN pip install ${pipPkgs}\n`;
    } else if (config.base.includes('node')) {
      const npmPkgs = config.packages.language.map(p => p.version !== 'latest' ? `${p.name}@${p.version}` : p.name).join(' ');
      df += `RUN npm install -g ${npmPkgs}\n`;
    }
  }

  df += `CMD ["bash"]\n`;
  return df;
};

// --- START SERVER ---
const server = app.listen(3001, () => {
  console.log('🚀 Backend IDE Server running on http://localhost:3001');
});

// --- WEBSOCKET ORCHESTRATOR ---
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  // Parse the requested environment from the connection URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const envName = url.searchParams.get('env');
  
  // Create a safe, lowercase image name for Docker (or fallback to ubuntu:latest)
  const safeImageName = envName && envName !== 'Default' 
    ? `custom-ide-${envName.toLowerCase().replace(/[^a-z0-9]/g, '-')}` 
    : 'ubuntu:latest';

  let ptyProcess = null;

  try {
    // --- 1. DYNAMIC DOCKER BUILD PROCESS ---
    if (envName && envName !== 'Default') {
      const db = getEnvironments();
      const config = db.find(e => e.name === envName);

      if (config) {
        ws.send(`\r\n\x1b[1;36m[System] Generating Dockerfile for ${envName}...\x1b[0m\r\n`);
        const dockerfileContent = generateDockerfile(config);
        
        // Write the temporary Dockerfile to disk
        const buildDir = path.join(__dirname, 'builds', safeImageName);
        if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
        fs.writeFileSync(path.join(buildDir, 'Dockerfile'), dockerfileContent);

        ws.send(`\x1b[1;33m[System] Building image (this may take a minute)...\x1b[0m\r\n\r\n`);

        // Spawn the Docker Build process and stream logs
        await new Promise((resolve, reject) => {
          const buildProcess = spawn('docker', ['build', '-t', safeImageName, '.'], { cwd: buildDir });
          
          buildProcess.stdout.on('data', (data) => ws.send(data.toString().replace(/\n/g, '\r\n')));
          buildProcess.stderr.on('data', (data) => ws.send(`\x1b[1;31m${data.toString().replace(/\n/g, '\r\n')}\x1b[0m`));
          
          buildProcess.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Docker build failed with code ${code}`));
          });
        });
        
        ws.send(`\r\n\x1b[1;32m[System] Build complete! Spawning container...\x1b[0m\r\n\r\n`);
      }
    }

    // --- 2. SPAWN THE INTERACTIVE TERMINAL ---
    ptyProcess = pty.spawn('docker', [
      'run', '-it', '--rm', 
      '-e', 'TERM=xterm-256color', // 🚨 CLEAR BUG FIX: Tell Ubuntu exactly what terminal emulator we are using
      safeImageName, 
      'bash'
    ], {
      name: 'xterm-256color', // Match the TERM env variable
      cols: 80,
      rows: 24,
    });

    // 🚨 MISSING LINE FIX: We must pipe Docker's output BACK to the WebSocket
    // so the React frontend can actually see what Bash is doing!
    ptyProcess.onData((data) => {
      ws.send(data);
    });

    // --- 3. INCOMING WEBSOCKET ROUTER ---
    // Handle all messages coming from the React frontend
    ws.on('message', (message) => {
      // Convert the raw binary buffer into a string safely
      const msgStr = message.toString();
      
      // Check if the frontend sent our custom resize JSON
      if (msgStr.startsWith('{"type":"resize"')) {
        try {
          const { cols, rows } = JSON.parse(msgStr);
          if (ptyProcess) ptyProcess.resize(cols, rows);
        } catch (e) {}
      } else {
        // Otherwise, pipe the raw keystrokes straight to the Docker process
        if (ptyProcess) ptyProcess.write(msgStr);
      }
    });

    ws.on('close', () => {
      console.log(`🔴 Disconnected from ${safeImageName}. Killing container...`);

      // TODO: add a message to show we have killed the container
      try { if (ptyProcess) ptyProcess.kill(); } catch (e) {}
    });

  } catch (err) {
    console.error("Workflow failed:", err);
    ws.send(`\r\n\x1b[1;31mError: ${err.message}\x1b[0m\r\n`);
  }
});