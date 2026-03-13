import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';


import PyWorker from './repl/pyWorker.js?worker'
import JsWorker from './repl/jsWorker.js?worker';
import RubyWorker from './repl/rubyWorker.js?worker';

export default function TerminalComponent({ environment, files }) {
  const terminalContainerRef = useRef(null);
  const termInstance = useRef(null);
  const workerRef = useRef(null);
  const currentCommand = useRef('');
  const isInitialized = useRef(false);

  // 1. Initialize Terminal Safely
  useEffect(() => {
    // THE FIX: Wait 100ms for Tailwind to paint the UI layout before touching xterm
    const bootTimeout = setTimeout(() => {
      if (!terminalContainerRef.current) return;
      terminalContainerRef.current.innerHTML = ''; // Clear strict mode duplicates

      const term = new Terminal({ 
        theme: { background: '#1e1e1e', foreground: '#cccccc' }, 
        cursorBlink: true, 
        fontFamily: '"JetBrains Mono", monospace', 
        fontSize: 14 
      });
      
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalContainerRef.current); // No more dimensions crash!
      termInstance.current = term;

      // Fit after opening
      setTimeout(() => {
        try { fitAddon.fit(); } catch (e) {}
      }, 50);

      const resizeObserver = new ResizeObserver(() => {
        if (terminalContainerRef.current && terminalContainerRef.current.clientWidth > 0) {
          try { fitAddon.fit(); } catch (e) {}
        }
      });
      resizeObserver.observe(terminalContainerRef.current);

      // --- Global Event Listeners ---
      const handleRunFile = (e) => {
        const file = e.detail;
        if (workerRef.current) {
          term.writeln(`\r\n\x1b[1;32m$ Executing ${file.name}...\x1b[0m`);
          workerRef.current.postMessage({ type: 'RUN', payload: file.content });
        } else {
          term.writeln(`\r\n\x1b[1;31mPlease connect to an environment first.\x1b[0m`);
        }
      };

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

      // --- Keystroke Listener ---
      const onDataDisposable = term.onData((data) => {
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
        } else if (data === '\x7f') {
          if (currentCommand.current.length > 0) {
            currentCommand.current = currentCommand.current.slice(0, -1);
            term.write('\b \b');
          }
        } else if (data.startsWith('\x1b')) {
          if (environment === 'remote-linux' && workerRef.current?.postMessage) {
              workerRef.current.postMessage({ type: 'RUN', payload: data });
          }
          return; 
        } else {
          if (environment === 'remote-linux') {
              workerRef.current?.postMessage({ type: 'RUN', payload: data });
          } else {
              currentCommand.current += data;
              term.write(data);
          }
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
    }, 100); // 100ms delay

    // Cleanup function for React unmount
    return () => {
      clearTimeout(bootTimeout);
      if (terminalContainerRef.current?._cleanup) {
        terminalContainerRef.current._cleanup();
      }
      termInstance.current = null;
    };
  }, []); // Only run once

  // 2. Handle Worker Connections
  useEffect(() => {
    const term = termInstance.current;
    if (!term) return;

    // Helper to spin up a worker cleanly
    const connectWorker = (WorkerClass, envName, syncFiles) => {
      term.writeln(`\x1b[1;33mStarting ${envName}...\x1b[0m`);
      if (workerRef.current) workerRef.current.terminate();
      
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

    // The Router
    if (environment === 'python-wasm') {
      connectWorker(PyWorker, 'Local WASM (Python)', true);
    } else if (environment === 'js-worker') {
      connectWorker(JsWorker, 'Local Worker (JavaScript)', false);
    } else if (environment === 'ruby-wasm') {
      connectWorker(RubyWorker, 'Local WASM (Ruby)', false);
    } else if (environment === 'remote-linux') {
      term.writeln('\x1b[1;33mConnecting to Remote Linux (Docker)...\x1b[0m');
      
      // Clean up any existing worker
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      // Connect to our new Node.js backend
      const ws = new WebSocket('ws://localhost:3001');
      
      ws.onopen = () => {
        term.writeln('\r\n\x1b[1;32mConnected to isolated Ubuntu container.\x1b[0m');
      };

      ws.onmessage = (event) => {
        term.write(event.data);
      };

      // We need to attach the WebSocket to a ref so we can send data to it
      // Let's creatively use the workerRef for now since we aren't using a worker!
      workerRef.current = {
        postMessage: (msg) => {
          if (msg.type === 'RUN' && ws.readyState === WebSocket.OPEN) {
            ws.send(msg.payload + '\r'); 
          }
        },
        terminate: () => ws.close()
      };
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [environment]);

  useEffect(() => {
    if (environment === 'python-wasm' && workerRef.current) {
      workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });
    }
  }, [files, environment]);

  // FIX: Added textAlign: 'left' to override Vite's App.css
  return <div ref={terminalContainerRef} style={{ height: '100%', width: '100%', overflow: 'hidden', textAlign: 'left' }} />;
}