// import React, { useEffect, useRef } from 'react';
// import { Terminal } from 'xterm';
// import { FitAddon } from 'xterm-addon-fit';
// import 'xterm/css/xterm.css';


// import PyWorker from './repl/pyWorker.js?worker'
// import JsWorker from './repl/jsWorker.js?worker';
// import RubyWorker from './repl/rubyWorker.js?worker';

// export default function TerminalComponent({ environment, files }) {
//   const terminalContainerRef = useRef(null);
  
//   const envRef = useRef(environment);
//   const termInstance = useRef(null);
//   const workerRef = useRef(null);
//   const currentCommand = useRef('');
//   const isInitialized = useRef(false);

//   // Add this to track the live environment state!
//   useEffect(() => {
//     envRef.current = environment;
//   }, [environment]);


//   // 1. Initialize Terminal Safely
//   useEffect(() => {
//     // THE FIX: Wait 100ms for Tailwind to paint the UI layout before touching xterm
//     const bootTimeout = setTimeout(() => {
//       if (!terminalContainerRef.current) return;
//       terminalContainerRef.current.innerHTML = ''; // Clear strict mode duplicates

//       const term = new Terminal({ 
//         theme: { background: '#1e1e1e', foreground: '#cccccc' }, 
//         cursorBlink: true, 
//         fontFamily: '"JetBrains Mono", monospace', 
//         fontSize: 14 
//       });
      
//       const fitAddon = new FitAddon();
//       term.loadAddon(fitAddon);
//       term.open(terminalContainerRef.current); // No more dimensions crash!
//       termInstance.current = term;

//       // Fit after opening
//       setTimeout(() => {
//         try { fitAddon.fit(); } catch (e) {}
//       }, 50);

//       const resizeObserver = new ResizeObserver(() => {
//         if (terminalContainerRef.current && terminalContainerRef.current.clientWidth > 0) {
//           try { 
//             fitAddon.fit(); 
//             // 🚨 RESIZE SYNC FIX: Tell Docker the new dimensions!
//             if (environment === 'remote-linux' && workerRef.current?.postMessage) {
//               const dimensions = JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows });
//               workerRef.current.postMessage({ type: 'RUN', payload: dimensions });
//             }
//           } catch (e) {}
//         }
//       });

//       // --- Global Event Listeners ---
//       const handleRunFile = (e) => {
//         const file = e.detail;
//         if (workerRef.current) {
//           term.writeln(`\r\n\x1b[1;32m$ Executing ${file.name}...\x1b[0m`);
//           workerRef.current.postMessage({ type: 'RUN', payload: file.content });
//         } else {
//           term.writeln(`\r\n\x1b[1;31mPlease connect to an environment first.\x1b[0m`);
//         }
//       };

//       const handleCopy = () => {
//         const selection = term.getSelection();
//         if (selection) {
//           navigator.clipboard.writeText(selection);
//         } else {
//           term.selectAll();
//           navigator.clipboard.writeText(term.getSelection());
//           term.clearSelection();
//         }
//       };

//       window.addEventListener('run-terminal-code', handleRunFile);
//       window.addEventListener('copy-terminal', handleCopy);

//       // TODO: fix this
//       // --- Keystroke & Input Listener ---

//       const onDataDisposable = term.onData((data) => {
        
//         // 🚨 USE THE REF: This guarantees we know we are in Docker!
//         if (envRef.current === 'remote-linux') {
//           if (workerRef.current?.postMessage) {
//               // Send everything (including Ctrl+C, pastes, and clear) raw to the backend
//               workerRef.current.postMessage({ type: 'RUN', payload: data });
//           }
//           return; // STOP EXECUTION HERE
//         }

//         // --- LOCAL WASM/WORKER LOGIC ---
//         if (data === '\r') {
//           term.writeln('');
//           const cmd = currentCommand.current; 
//           if (cmd.trim() !== '' || cmd === '') { 
//             if (workerRef.current) {
//               workerRef.current.postMessage({ type: 'RUN', payload: cmd });
//             } else {
//               term.write('\x1b[1;32m$ \x1b[0m'); 
//             }
//           }
//           currentCommand.current = '';
//         } else if (data === '\x03') {
//           // Ctrl+C locally
//           term.write('^C\r\n\x1b[1;32m>>> \x1b[0m');
//           currentCommand.current = '';
//         } else if (data === '\x7f') {
//           // Backspace locally
//           if (currentCommand.current.length > 0) {
//             currentCommand.current = currentCommand.current.slice(0, -1);
//             term.write('\b \b');
//           }
//         } else {
//           currentCommand.current += data;
//           term.write(data);
//         }
//       });

//       // Attach cleanup methods to the ref so we can call them when the component unmounts
//       terminalContainerRef.current._cleanup = () => {
//         resizeObserver.disconnect();
//         onDataDisposable.dispose();
//         fitAddon.dispose();
//         term.dispose();
//         window.removeEventListener('run-terminal-code', handleRunFile);
//         window.removeEventListener('copy-terminal', handleCopy);
//       };
//     }, 100); // 100ms delay

//     // Cleanup function for React unmount
//     return () => {
//       clearTimeout(bootTimeout);
//       if (terminalContainerRef.current?._cleanup) {
//         terminalContainerRef.current._cleanup();
//       }
//       termInstance.current = null;
//     };
//   }, []); // Only run once

//   // 2. Handle Worker Connections
//   useEffect(() => {
//     const term = termInstance.current;
//     if (!term) return;

//     // Helper to spin up a worker cleanly
//     const connectWorker = (WorkerClass, envName, syncFiles) => {
//       term.writeln(`\x1b[1;33mStarting ${envName}...\x1b[0m`);
//       if (workerRef.current) workerRef.current.terminate();
      
//       workerRef.current = new WorkerClass();
      
//       workerRef.current.onmessage = (event) => {
//         const { type, payload } = event.data;
//         if (type === 'SYSTEM') term.write(`\x1b[1;36m${payload}\x1b[0m`);
//         else if (type === 'STDOUT') term.write(payload);
//         else if (type === 'ERROR') term.write(`\x1b[1;31m${payload}\x1b[0m`);
//         else if (type === 'PROMPT') term.write('\x1b[1;32m>>> \x1b[0m');
//         else if (type === 'PROMPT_MULTI') term.write('\x1b[1;33m... \x1b[0m'); 
//       };

//       if (syncFiles) workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });
//     };

//     // The Router for the REPLs
//     if (environment === 'python-wasm') {
//       connectWorker(PyWorker, 'Local WASM (Python)', true);
//     } else if (environment === 'js-worker') {
//       connectWorker(JsWorker, 'Local Worker (JavaScript)', false);
//     } else if (environment === 'ruby-wasm') {
//       connectWorker(RubyWorker, 'Local WASM (Ruby)', false);
//     } else if (environment === 'remote-linux') {
//       term.writeln('\x1b[1;33mConnecting to Remote Linux (Docker)...\x1b[0m');
      
//       // Clean up any existing worker
//       if (workerRef.current) {
//         workerRef.current.terminate();
//         workerRef.current = null;
//       }

//       // NEW: Pass the environment name in the URL so the backend knows what to build!
//       // TODO: In the next step, we will make this dynamic based on the user's selection.
//       const targetEnvName = encodeURIComponent("Default"); 
//       const ws = new WebSocket(`ws://localhost:3001?env=${targetEnvName}`);
      
//       ws.onopen = () => {
//         term.writeln('\r\n\x1b[1;32mConnected to isolated Ubuntu container.\x1b[0m');
//       };

//       ws.onmessage = (event) => {
//         term.write(event.data);
//       };

//       // We need to attach the WebSocket to a ref so we can send data to it
//       // Let's creatively use the workerRef for now since we aren't using a worker!
//       workerRef.current = {
//         postMessage: (msg) => {
//           if (msg.type === 'RUN' && ws.readyState === WebSocket.OPEN) {
//             ws.send(msg.payload); 
//           }
//         },
//         terminate: () => ws.close()
//       };
//     }

//     return () => {
//       if (workerRef.current) {
//         workerRef.current.terminate();
//         workerRef.current = null;
//       }
//     };
//   }, [environment]);

//   useEffect(() => {
//     if (environment === 'python-wasm' && workerRef.current) {
//       workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });
//     }
//   }, [files, environment]);

//   // FIX: Added textAlign: 'left' to override Vite's App.css
//   return <div ref={terminalContainerRef} style={{ height: '100%', width: '100%', overflow: 'hidden', textAlign: 'left' }} />;
// }

import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import PyWorker from './repl/pyWorker.js?worker';
import JsWorker from './repl/jsWorker.js?worker';
import RubyWorker from './repl/rubyWorker.js?worker';

export default function TerminalComponent({ environment, files }) {
  const terminalContainerRef = useRef(null);
  
  // We use refs to hold mutable state that doesn't trigger React re-renders.
  // envRef is critical: it lets our xterm event listeners always know the 
  // CURRENT environment without getting trapped in a "stale closure" from the past.
  const envRef = useRef(environment);
  const termInstance = useRef(null);
  const workerRef = useRef(null);
  const currentCommand = useRef('');

  // Update our tracking ref whenever the environment prop changes
  useEffect(() => {
    envRef.current = environment;
  }, [environment]);

  // --- 1. INITIALIZE TERMINAL SAFELY ---
  useEffect(() => {
    // We wait 100ms before booting the terminal to ensure Tailwind CSS
    // has finished painting the DOM. If we boot immediately, the container
    // might have 0 height, causing xterm to crash.
    const bootTimeout = setTimeout(() => {
      if (!terminalContainerRef.current) return;
      terminalContainerRef.current.innerHTML = ''; // Prevent React strict-mode duplicates

      // Configure the visual look of the terminal
      const term = new Terminal({ 
        theme: { background: '#1e1e1e', foreground: '#cccccc' }, 
        cursorBlink: true, 
        fontFamily: '"JetBrains Mono", monospace', 
        fontSize: 14 
      });
      
      // Load the fit addon so the terminal automatically resizes to its container
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current);
      termInstance.current = term;

      // Give xterm an extra 50ms to calculate character dimensions before fitting
      setTimeout(() => {
        try { fitAddon.fit(); } catch (e) {}
      }, 50);

      // Listen for browser window resizes to adjust the terminal grid
      const resizeObserver = new ResizeObserver(() => {
        if (terminalContainerRef.current && terminalContainerRef.current.clientWidth > 0) {
          try { 
            fitAddon.fit(); 
            // 🚨 RESIZE SYNC: Tell the remote Docker container the new grid dimensions 
            // so text wrapping works properly when the user resizes the window.
            if (envRef.current === 'remote-linux' && workerRef.current?.postMessage) {
              const dimensions = JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows });
              workerRef.current.postMessage({ type: 'RUN', payload: dimensions });
            }
          } catch (e) {}
        }
      });
      resizeObserver.observe(terminalContainerRef.current);

      // --- Global Event Listeners ---
      
      // Allows the IDE Action Bar to execute the currently open file
      const handleRunFile = (e) => {
        const file = e.detail;
        if (workerRef.current) {
          term.writeln(`\r\n\x1b[1;32m$ Executing ${file.name}...\x1b[0m`);
          workerRef.current.postMessage({ type: 'RUN', payload: file.content });
        } else {
          term.writeln(`\r\n\x1b[1;31mPlease connect to an environment first.\x1b[0m`);
        }
      };

      // Handles copying text from the terminal
      const handleCopy = () => {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection);
        } else {
          term.selectAll();
          navigator.clipboard.writeText(term.getSelection());
          term.clearSelection();
        }
      };

      window.addEventListener('run-terminal-code', handleRunFile);
      window.addEventListener('copy-terminal', handleCopy);

      // --- Keystroke & Input Listener ---
      // This function fires every time a key is pressed inside the terminal.
      const onDataDisposable = term.onData((data) => {
        
        // 1. REMOTE LINUX (DOCKER) ROUTING
        // If connected to Docker, we do absolutely zero local processing.
        // We send the raw keystroke directly to the WebSocket and let the 
        // Linux shell handle echoing, backspaces, shortcuts, and commands.
        if (envRef.current === 'remote-linux') {
          if (workerRef.current?.postMessage) {
              workerRef.current.postMessage({ type: 'RUN', payload: data });
          }
          return; // Stop execution to prevent local collision
        }

        // 2. LOCAL WASM/WORKER ROUTING
        // Since there is no real OS here, we have to fake it.
        // We intercept special keys (Enter, Backspace, Ctrl+C) to control the buffer.
        // (Note: The false "clear" assumption has been reverted here).
        if (data === '\r') {
          term.writeln('');
          const cmd = currentCommand.current; 
          if (cmd.trim() !== '' || cmd === '') { 
            if (workerRef.current) {
              workerRef.current.postMessage({ type: 'RUN', payload: cmd });
            } else {
              term.write('\x1b[1;32m$ \x1b[0m'); 
            }
          }
          currentCommand.current = '';
        } else if (data === '\x03') {
          // Ctrl+C locally
          term.write('^C\r\n\x1b[1;32m>>> \x1b[0m');
          currentCommand.current = '';
        } else if (data === '\x7f') {
          // Backspace locally
          if (currentCommand.current.length > 0) {
            currentCommand.current = currentCommand.current.slice(0, -1);
            term.write('\b \b'); 
          }
        } else {
          // Normal typing
          currentCommand.current += data; 
          term.write(data); 
        }
      });

      // Attach cleanup methods to the ref so we can call them when the component unmounts
      terminalContainerRef.current._cleanup = () => {
        resizeObserver.disconnect();
        onDataDisposable.dispose();
        fitAddon.dispose();
        term.dispose();
        window.removeEventListener('run-terminal-code', handleRunFile);
        window.removeEventListener('copy-terminal', handleCopy);
      };
    }, 100); 

    return () => {
      clearTimeout(bootTimeout);
      if (terminalContainerRef.current?._cleanup) {
        terminalContainerRef.current._cleanup();
      }
      termInstance.current = null;
    };
  }, []); // Only run once on component mount

  // --- 2. HANDLE WORKER CONNECTIONS ---
  useEffect(() => {
    const term = termInstance.current;
    if (!term) return;

    // Helper to spin up a local Web Worker cleanly
    const connectWorker = (WorkerClass, envName, syncFiles) => {
      term.writeln(`\x1b[1;33mStarting ${envName}...\x1b[0m`);
      if (workerRef.current && typeof workerRef.current.terminate === 'function') {
         workerRef.current.terminate();
      }
      
      workerRef.current = new WorkerClass();
      
      workerRef.current.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'SYSTEM') term.write(`\x1b[1;36m${payload}\x1b[0m`);
        else if (type === 'STDOUT') term.write(payload);
        else if (type === 'ERROR') term.write(`\x1b[1;31m${payload}\x1b[0m`);
        else if (type === 'PROMPT') term.write('\x1b[1;32m>>> \x1b[0m');
        else if (type === 'PROMPT_MULTI') term.write('\x1b[1;33m... \x1b[0m'); 
      };

      if (syncFiles) workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });
    };

    // --- The Environment Router ---
    if (environment === 'python-wasm') {
      connectWorker(PyWorker, 'Local WASM (Python)', true);
    } else if (environment === 'js-worker') {
      connectWorker(JsWorker, 'Local Worker (JavaScript)', false);
    } else if (environment === 'ruby-wasm') {
      connectWorker(RubyWorker, 'Local WASM (Ruby)', false);
    } else if (environment === 'remote-linux') {
      
      term.writeln('\x1b[1;33mConnecting to Remote Linux (Docker)...\x1b[0m');
      
      if (workerRef.current && typeof workerRef.current.terminate === 'function') {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      const targetEnvName = encodeURIComponent("Default"); 
      const ws = new WebSocket(`ws://localhost:3001?env=${targetEnvName}`);
      
      ws.onopen = () => {
        term.writeln('\r\n\x1b[1;32mConnected to isolated Ubuntu container.\x1b[0m');
      };

      // Stream data directly from Docker into the terminal UI
      ws.onmessage = (event) => {
        term.write(event.data);
      };

      // We mock the workerRef so our onData listener can uniformly send data
      // without needing to know if it's talking to a Worker or a WebSocket.
      workerRef.current = {
        postMessage: (msg) => {
          if (msg.type === 'RUN' && ws.readyState === WebSocket.OPEN) {
            // 🚨 DOCKER FIX: Send pure keystroke, DO NOT attach \r.
            // If we send \r with every letter, it evaluates instantly.
            ws.send(msg.payload); 
          }
        },
        terminate: () => ws.close()
      };
    }

    return () => {
      if (workerRef.current && typeof workerRef.current.terminate === 'function') {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [environment]);

  // Keep the Python worker's file system in sync with the React UI
  useEffect(() => {
    if (environment === 'python-wasm' && workerRef.current) {
      workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });
    }
  }, [files, environment]);

  return <div ref={terminalContainerRef} style={{ height: '100%', width: '100%', overflow: 'hidden', textAlign: 'left' }} />;
}