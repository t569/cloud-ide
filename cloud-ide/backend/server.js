const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const cors = require('cors');

const app = express();
app.use(cors());

const server = app.listen(3001, () => {
  console.log('🚀 Backend IDE Server running on port 3001');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('Browser connected. Spawning isolated Docker container...');

  // Spawn an ephemeral Ubuntu container
  // --rm ensures the container is completely deleted from your hard drive when closed
  // -it runs it in interactive terminal mode
  const ptyProcess = pty.spawn('docker', [
    'run', '-it', '--rm', 
    'ubuntu:latest', 
    'bash'
  ], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
  });

  // 1. Send Docker's terminal output to the React frontend
  ptyProcess.onData((data) => {
    ws.send(data);
  });

  // 2. Receive keystrokes from the React frontend and pipe them to Docker
  ws.on('message', (command) => {
    ptyProcess.write(command);
  });

  // 3. Clean up when the user closes the browser tab or disconnects
  ws.on('close', () => {
    console.log('Browser disconnected. Destroying container...');
    ptyProcess.kill();
  });
});