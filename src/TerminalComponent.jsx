import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import PyWorker from './wasmWorker.js?worker';

export default function TerminalComponent({ environment, files }) {
  const terminalContainerRef = useRef(null);
  const termInstance = useRef(null);
  const workerRef = useRef(null);
  const currentCommand = useRef('');
  const isInitialized = useRef(false);

  useEffect(() => {
    if (isInitialized.current || !terminalContainerRef.current) return;
    isInitialized.current = true;

    const term = new Terminal({ 
      theme: { background: '#1e1e1e', foreground: '#cccccc' }, 
      cursorBlink: true, 
      fontFamily: '"JetBrains Mono", monospace', 
      fontSize: 14 
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainerRef.current);
    termInstance.current = term;

    setTimeout(() => {
      try { fitAddon.fit(); } catch (e) {}
    }, 10);

    const resizeObserver = new ResizeObserver(() => {
      if (terminalContainerRef.current && terminalContainerRef.current.clientWidth > 0) {
        try { fitAddon.fit(); } catch (e) {}
      }
    });
    resizeObserver.observe(terminalContainerRef.current);


    // --- NEW: Global Event Listeners for the UI Buttons ---
  
    // This is for running the current file
    const handleRunFile = (e) => {
      const file = e.detail;
      if (workerRef.current) {
        term.writeln(`\r\n\x1b[1;32m$ Executing ${file.name}...\x1b[0m`);
        workerRef.current.postMessage({ type: 'RUN', payload: file.content });
      } else {
        term.writeln(`\r\n\x1b[1;31mPlease connect to an environment first.\x1b[0m`);
      }
    };

    // This is to handle copying of the terminal
    const handleCopy = () => {
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      } else {
        // If nothing is highlighted, copy the entire terminal screen
        term.selectAll();
        navigator.clipboard.writeText(term.getSelection());
        term.clearSelection();
      }
    };

    window.addEventListener('run-terminal-code', handleRunFile);
    window.addEventListener('copy-terminal', handleCopy);


   const onDataDisposable = term.onData((data) => {
      if (data === '\r') {
        // Enter Key
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
        // Backspace
        if (currentCommand.current.length > 0) {
          currentCommand.current = currentCommand.current.slice(0, -1);
          term.write('\b \b');
        }
      } else if (data.startsWith('\x1b')) {
        // THE FIX: Ignore ANSI Escape Sequences!
        // This prevents Arrow Keys from injecting invisible junk into Python.
        return; 
      } else {
        // Standard typing
        currentCommand.current += data;
        term.write(data);
      }
    });

    return () => {
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      fitAddon.dispose();
      term.dispose();
      termInstance.current = null;
      isInitialized.current = false;
      
      // NEW: Cleanup event listeners
      window.removeEventListener('run-terminal-code', handleRunFile);
      window.removeEventListener('copy-terminal', handleCopy);
    };
  }, []);

  useEffect(() => {
    const term = termInstance.current;
    if (!term) return;

    if (environment === 'python-wasm') {
      term.writeln(`\x1b[1;33mStarting Local WASM (Python)...\x1b[0m`);
      
      if (workerRef.current) workerRef.current.terminate();
      
      workerRef.current = new PyWorker();
      
      workerRef.current.onmessage = (event) => {
        const { type, payload } = event.data;
        if (type === 'SYSTEM') term.write(`\x1b[1;36m${payload}\x1b[0m`);
        else if (type === 'STDOUT') term.write(payload);
        else if (type === 'ERROR') term.write(`\x1b[1;31m${payload}\x1b[0m`);
        else if (type === 'PROMPT') term.write('\x1b[1;32m>>> \x1b[0m');
        // NEW: Handle multi-line prompt
        else if (type === 'PROMPT_MULTI') term.write('\x1b[1;33m... \x1b[0m'); 
      };

      workerRef.current.postMessage({ type: 'SYNC_FILES', payload: files });

    } else if (environment === 'remote-linux') {
      if (workerRef.current) workerRef.current.terminate();
      workerRef.current = null;
      term.writeln('\x1b[1;31mRemote Linux environment not connected. Running in local echo mode.\x1b[0m');
      
      // NEW: Print the initial dollar sign prompt for the Linux terminal
      term.write('\x1b[1;32m$ \x1b[0m');
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