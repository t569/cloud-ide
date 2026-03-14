const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const cors = require('cors');
const fs = require('fs'); // NEW: File system module
const path = require('path'); // NEW: Path module

const app = express();
app.use(cors());
app.use(express.json()); // NEW: Allows Express to read JSON data from React

const DB_FILE = path.join(__dirname, 'environments.json');

// --- NEW: THE JSON DATABASE API ---

// Helper to read the JSON file safely
const getEnvironments = () => {
  if (!fs.existsSync(DB_FILE)) return [];
  const data = fs.readFileSync(DB_FILE, 'utf8');
  return JSON.parse(data);
};

// GET: Send all saved environments to the frontend
app.get('/api/environments', (req, res) => {
  res.json(getEnvironments());
});

// POST: Save a new environment from the frontend
app.post('/api/environments', (req, res) => {
  const newEnv = req.body;
  const db = getEnvironments();
  
  // Give it a unique ID
  newEnv.id = Date.now().toString(); 
  db.push(newEnv);
  
  // Save it back to the file
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  res.json({ success: true, environment: newEnv });
});

// ----------------------------------

const server = app.listen(3001, () => {
  console.log('🚀 Backend IDE Server running on http://localhost:3001');
});


// Attach WebSockets to the server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('🟢 Browser connected. Spawning isolated Docker container...');

  try {
    // Spawn a brand new, ephemeral Ubuntu container for this specific user
    // --rm : Deletes the container the moment they close the browser tab
    // -it  : Runs it in interactive terminal mode
    const ptyProcess = pty.spawn('docker', [
      'run', '-it', '--rm', 
      'ubuntu:latest', 
      'bash'
    ], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
    });

    // 1. Send Docker's terminal output directly to the React frontend
    ptyProcess.onData((data) => {
      ws.send(data);
    });

    // 2. Receive keystrokes from the React frontend and pipe them to Docker
    ws.on('message', (command) => {
      ptyProcess.write(command);
    });

    // 3. Clean up when the user closes the browser tab or switches environments
    ws.on('close', () => {
      console.log('🔴 Browser disconnected. Destroying container...');
      try {
        ptyProcess.kill();
      } catch (e) {
        console.log('Process already killed.');
      }
    });

  } catch (err) {
    console.error("Failed to spawn Docker process:", err);
    ws.send("\r\n\x1b[1;31mError: Backend failed to spawn Docker container. Is Docker running?\x1b[0m\r\n");
  }
});