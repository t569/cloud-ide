// src/jsWorker.js
// REPL for JavaScript

// ==========================================
// SECURITY: sandbox the eval() below (finding #3)
// ==========================================
// This REPL eval()s arbitrary code. A Worker has no DOM/cookie access, but it
// CAN reach the network — and same-origin fetches ride the user's session
// cookie (credentials: 'include' on our apiClient). A malicious or shared
// snippet could read authenticated VFS/API data and exfiltrate it. This REPL
// needs ZERO network, so revoke every egress + code-loading primitive before
// any user code runs. importScripts/Worker are revoked too, so eval'd code
// cannot pull in a fresh reference. Locked (writable/configurable: false) so it
// can't be reassigned. Keep this block FIRST — nothing may run before it.
for (const name of [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'importScripts', 'Worker', 'SharedWorker',
]) {
  try {
    Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false });
  } catch (_) { /* best-effort: some hosts mark these non-configurable */ }
}
// navigator.sendBeacon is a fire-and-forget exfil channel; neutralize just it
// (leave the rest of navigator, which is harmless read-only info in a worker).
try {
  if (self.navigator) {
    Object.defineProperty(self.navigator, 'sendBeacon', { value: undefined, writable: false, configurable: false });
  }
} catch (_) { /* best-effort */ }

let codeBuffer = "";

// 1. Intercept console.log and console.error to route them back to our xterm.js UI
const originalLog = console.log;
console.log = (...args) => {
  const output = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
  self.postMessage({ type: 'STDOUT', payload: output + '\r\n' });
};

const originalError = console.error;
console.error = (...args) => {
  const output = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" ");
  self.postMessage({ type: 'ERROR', payload: output + '\r\n' });
};

self.postMessage({ type: 'SYSTEM', payload: 'JavaScript (V8) Environment Ready.\r\n' });
self.postMessage({ type: 'PROMPT' });

self.onmessage = (event) => {
  if (event.data.type === 'SYNC_FILES') return; // MVP: We will skip mocking the Node fs module for now

  if (event.data.type === 'RUN') {
    let code = event.data.payload;

    // Handle multiline blocks (e.g., functions, loops)
    if (codeBuffer.length > 0) {
      if (code.trim() === "") {
        code = codeBuffer;
        codeBuffer = ""; 
      } else {
        codeBuffer += code + "\n";
        self.postMessage({ type: 'PROMPT_MULTI' });
        return;
      }
    } else if (code.trim().endsWith("{")) {
      codeBuffer = code + "\n";
      self.postMessage({ type: 'PROMPT_MULTI' });
      return;
    }

    try {
      // Execute the JS code in the global worker scope
      const result = (1, eval)(code);
      if (result !== undefined) {
        self.postMessage({ type: 'STDOUT', payload: String(result) + '\r\n' });
      }
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: err.message + '\r\n' });
      codeBuffer = ""; 
    }
    self.postMessage({ type: 'PROMPT' });
  }
};