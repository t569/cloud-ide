// src/server.js
const express = require('express');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const environmentRoutes = require('./api/environmentRoutes');
const WebSocketManager = require('./transport/WebSocketManager');

const app = express();
app.use(cors());
app.use(express.json());

// 1. HTTP Routes
app.use('/api/environments', environmentRoutes);

// 2. Start Server
const server = app.listen(3001, () => {
  console.log('🚀 Backend IDE Server running on http://localhost:3001');
});

// 3. WebSocket Orchestrator
const wss = new WebSocketServer({ server });
const wsManager = new WebSocketManager();


// spin up the server, then give it to the manager to handle the rest
wss.on('connection', (ws, req) => {
  wsManager.handleConnection(ws, req);
});