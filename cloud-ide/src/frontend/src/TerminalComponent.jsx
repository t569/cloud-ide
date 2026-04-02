import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import PyWorker from './repl/pyWorker.js?worker';
import JsWorker from './repl/jsWorker.js?worker';
import RubyWorker from './repl/rubyWorker.js?worker';

export default function TerminalComponent({ environment, files }) {
  const terminalContainerRef = useRef(null);
  
  // --- STATE TRACKING REFS ---
  // We use refs to hold mutable state because changing them doesn't trigger React re-renders.
  // envRef is critical: it lets our xterm event listeners always know the CURRENT 
  // environment without getting trapped in a "stale closure" from the past.
  const envRef = useRef(environment);
  const termInstance = useRef(null);
  const workerRef = useRef(null);
  
  // --- TYPING BUFFERS ---
  const currentCommand = useRef(''); // Used for Local WASM to build full commands before sending
  const remoteInputBuffer = useRef(''); // NEW: Tracks the last 10 characters typed into Docker (Used for ConPTY fix)

  // Update our tracking ref whenever the user changes the environment via the dropdown
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
      terminalContainerRef.current.innerHTML = ''; // Prevent React strict-mode from rendering 2 terminals

      // Configure the visual look of the terminal canvas
      const term = new Terminal({ 
        theme: { background: '#1e1e1e', foreground: '#cccccc' }, 
        cursorBlink: true, 
        fontFamily: '"JetBrains Mono", monospace', 
        fontSize: 14 
      });
      
      // Load the fit addon so the terminal automatically scales to the size of the window
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current);
      termInstance.current = term;

      // Give xterm an extra 50ms to calculate character dimensions before executing the fit
      setTimeout(() => {
        try { fitAddon.fit(); } catch (e) {}
      }, 50);

      // Listen for browser window resizes to adjust the terminal grid dynamically
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

      // --- Global IDE Event Listeners ---
      
      // Allows the IDE Action Bar "Run" button to execute the currently open file
      const handleRunFile = (e) => {
        const file = e.detail;
        if (workerRef.current) {
          term.writeln(`\r\n\x1b[1;32m$ Executing ${file.name}...\x1b[0m`);
          workerRef.current.postMessage({ type: 'RUN', payload: file.content });
        } else {
          term.writeln(`\r\n\x1b[1;31mPlease connect to an environment first.\x1b[0m`);
        }
      };

      // Handles copying text from the terminal when the IDE "Copy" button is clicked
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
      // This function fires instantly every time a single key is pressed inside the terminal.
      const onDataDisposable = term.onData((data) => {
        
        // --- 1. REMOTE LINUX (DOCKER) ROUTING ---
        if (envRef.current === 'remote-linux') {
          
          // Keep a rolling 10-character sliding window of exactly what the user is typing
          remoteInputBuffer.current += data;
          if (remoteInputBuffer.current.length > 10) {
            remoteInputBuffer.current = remoteInputBuffer.current.slice(-10);
          }

          // Send the keystroke to Docker immediately (1 byte at a time, exactly like a real keyboard)
          if (workerRef.current?.postMessage) {
              workerRef.current.postMessage({ type: 'RUN', payload: data });
          }

          // 🚨 THE WINDOWS CONPTY FIX 🚨
          // Windows translates the Linux 'clear' command into 24 blank lines, ruining the prompt.
          // Did the user just hit Enter (\r) after typing 'clear', or press Ctrl+L (\x0c)?
          const justTypedClear = data === '\r' && remoteInputBuffer.current.toLowerCase().endsWith('clear\r');
          const justTypedCtrlL = data === '\x0c';

          if (justTypedClear || justTypedCtrlL) {
            // Wait 100ms for Docker/Windows to spit out its garbage blank lines...
            setTimeout(() => {
              // Violently wipe the xterm.js frontend screen and scrollback buffer using ANSI codes
              term.write('\x1b[2J\x1b[3J\x1b[H');
              
              // Send a hidden "Enter" key to Docker to force Bash to reprint a fresh, active prompt at the top
              if (workerRef.current?.postMessage) {
                workerRef.current.postMessage({ type: 'RUN', payload: '\r' });
              }
            }, 100);
          }

          return; // Stop execution here. Do not run any Local WASM logic.
        }

        // --- 2. LOCAL WASM/WORKER ROUTING ---
        // Since there is no real OS here, we have to fake a shell.
        // We intercept special keys (Enter, Backspace, Ctrl+C) to control a fake typing buffer.
        if (data === '\r') {
          term.writeln(''); // Visual line break
          const cmd = currentCommand.current; 
          
          // Send completed string to the Worker
          if (cmd.trim() !== '' || cmd === '') { 
            if (workerRef.current) {
              workerRef.current.postMessage({ type: 'RUN', payload: cmd });
            } else {
              term.write('\x1b[1;32m$ \x1b[0m'); 
            }
          }
          currentCommand.current = ''; // Clear buffer for next command
        } else if (data === '\x03') {
          // User pressed Ctrl+C (\x03). Abort and print new line.
          term.write('^C\r\n\x1b[1;32m>>> \x1b[0m');
          currentCommand.current = '';
        } else if (data === '\x7f') {
          // User pressed Backspace (\x7f).
          if (currentCommand.current.length > 0) {
            currentCommand.current = currentCommand.current.slice(0, -1);
            term.write('\b \b'); // Move cursor back, overwrite with space, move back again
          }
        } else {
          // Standard typing: Add character to buffer and echo it to the screen
          currentCommand.current += data; 
          term.write(data); 
        }
      });

      // Attach cleanup methods to the ref so we can safely destroy them when React unmounts
      terminalContainerRef.current._cleanup = () => {
        resizeObserver.disconnect();
        onDataDisposable.dispose();
        fitAddon.dispose();
        term.dispose();
        window.removeEventListener('run-terminal-code', handleRunFile);
        window.removeEventListener('copy-terminal', handleCopy);
      };
    }, 100); 

    // Cleanup function for React unmount
    return () => {
      clearTimeout(bootTimeout);
      if (terminalContainerRef.current?._cleanup) {
        terminalContainerRef.current._cleanup();
      }
      termInstance.current = null;
    };
  }, []); 

  // --- 2. HANDLE WORKER CONNECTIONS ---
  useEffect(() => {
    const term = termInstance.current;
    if (!term) return;

    // Helper function to spin up a local Web Worker cleanly
    const connectWorker = (WorkerClass, envName, syncFiles) => {
      term.writeln(`\x1b[1;33mStarting ${envName}...\x1b[0m`);
      if (workerRef.current && typeof workerRef.current.terminate === 'function') {
         workerRef.current.terminate();
      }
      
      workerRef.current = new WorkerClass();
      
      // Handle ANSI color formatting for responses coming from the Web Worker
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
      
      // Clean up any existing local worker before connecting to the WebSocket
      if (workerRef.current && typeof workerRef.current.terminate === 'function') {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      // TODO: Connect this to the actual user selection instead of "Default"
      const targetEnvName = encodeURIComponent("Default"); 
      const ws = new WebSocket(`ws://localhost:3001?env=${targetEnvName}`);
      
      ws.onopen = () => {
        term.writeln('\r\n\x1b[1;32mConnected to isolated Ubuntu container.\x1b[0m');
      };

      // Stream data directly from Docker into the terminal UI
      ws.onmessage = (event) => {
        term.write(event.data);
      };

      // We mock the workerRef here. This allows our Keystroke Listener (above) to uniformly
      // send data using `workerRef.current.postMessage()` without needing to know if it's 
      // talking to a local Worker or a remote WebSocket.
      workerRef.current = {
        postMessage: (msg) => {
          if (msg.type === 'RUN' && ws.readyState === WebSocket.OPEN) {
            ws.send(msg.payload); // 🚨 DOCKER FIX: Send pure keystroke, DO NOT attach \r.
          }
        },
        terminate: () => ws.close()
      };
    }

    // Unmount cleanup to kill workers/sockets when switching environments
    return () => {
      if (workerRef.current && typeof workerRef.current.terminate === 'function') {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [environment]);

  // Keep the Python worker's virtual file system in sync with the React UI
  useEffect(() => {
    if (environment === 'python-wasm' && workerRef.current) {
      workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });
    }
  }, [files, environment]);

  return <div ref={terminalContainerRef} style={{ height: '100%', width: '100%', overflow: 'hidden', textAlign: 'left' }} />;
}