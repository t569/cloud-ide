// backend/deep-ping.js
const http = require('http');

const postData = JSON.stringify({
  image: {
    uri: "python:3.11-slim", // Changed 'name' to 'uri'
    pullPolicy: "IfNotPresent"
  },
  timeout: 3600, 
  resourceLimits: {
    cpuCount: "1",    // Changed to String
    memoryMb: "512"   // Changed to String
  },
  env: {
    "WORKDIR": "/workspace",
    "PYTHONUNBUFFERED": "1"
  },
  volumes: [],
  entrypoint: ["sleep", "infinity"] 
});

const options = {
  hostname: '127.0.0.1',
  port: 8080,
  path: '/sandboxes',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log("📡 Sending POST to http://127.0.0.1:8080/sandboxes...");
console.log(`📦 Payload: ${postData}`);

const req = http.request(options, (res) => {
  console.log(`✅ ENGINE RESPONDED - STATUS: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log(`📄 RESPONSE BODY: ${data}`);
    if (res.statusCode === 201 || res.statusCode === 200) {
      console.log("\n🔥 SUCCESS! The Engine is accepting data. The issue is definitely the 'fetch' implementation in your Controller.");
    }
  });
});

req.on('error', (e) => {
  console.error(`❌ POST FAILED: ${e.message}`);
});

req.write(postData);
req.end();