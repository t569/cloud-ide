// frontend/src/terminal/components/Terminal.tsx

// this is the final terminal component encapsulating the hook from src/terminal/hooks/useTerminal.ts

// TODO: line 30 down

import React, { useEffect, useRef } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import { InputManager } from '../core/InputManager';
import { MiddlewarePipeline } from '../core/MiddlewarePipeline';
import { WindowsClearFix } from '../core/middlewares/WindowsClearFix';
import { DockerStream } from '../transport/DockerStream';

export const TerminalComponent: React.FC = () => {
  const { terminalRef, xterm } = useTerminal();
  
  // Persist our core logic managers across React renders
  const inputManagerRef = useRef(new InputManager());
  const pipelineRef = useRef(new MiddlewarePipeline());
  const transportRef = useRef<DockerStream | null>(null);

  useEffect(() => {
    if (!xterm) return;

    const inputManager = inputManagerRef.current;
    const pipeline = pipelineRef.current;
    
    // Register our middlewares
    pipeline.use(new WindowsClearFix());


    // TODO: we can eitheruse docker or WASM

    // TODO: rewrite to have SessionStream for a particular session id not dockerstream
    // Docker stream is depreciated
    // DOCKER INIT
    // 1. Initialize the WebSocket connection to your Node backend
    const dockerStream = new DockerStream('ws://localhost:3001/');
    transportRef.current = dockerStream;

    dockerStream.connect().then(() => {
      xterm.writeln('\x1b[1;32mConnected to Docker Backend\x1b[0m');
      
      // Tell the backend our starting terminal dimensions
      dockerStream.resize(xterm.cols, xterm.rows);
    }).catch(err => {
      xterm.writeln('\x1b[1;31mFailed to connect to backend\x1b[0m');
    });


    // DOCKER STREAM
    // 2. Data FROM Backend -> Middleware -> Screen
    dockerStream.onData((rawData) => {
      const sanitizedData = pipeline.processIncoming(rawData);
      if (sanitizedData) {
        xterm.write(sanitizedData);
      }
    });

    // 3. Data FROM Screen (Typing) -> InputManager -> Transport
    const onDataDisposable = xterm.onData((data) => {
      const sanitizedOutgoing = pipeline.processOutgoing(data);
      // Pass the dockerStream to the InputManager so it can route the data
      inputManager.handleInput(sanitizedOutgoing, dockerStream);
    });



    // DOCKER TERMINAL RESIZE
    // 4. Handle Terminal Resizing (When the browser window shrinks/grows)
    const onResizeDisposable = xterm.onResize(({ cols, rows }) => {
      dockerStream.resize(cols, rows);
    });




    // SIGNAL HANDLERS
    // 5. Connect InputManager OS Signals
    inputManager.onSignal('SIGINT', () => {
      // Instead of just printing ^C locally, we send the actual hex code to the backend
      dockerStream.write('\x03'); 
    });

    inputManager.onSignal('EOF', () => {
      dockerStream.write('\x04');
    });


    // HANDLE TERMINAL UTILS
    // 6. Copy & Paste
    const onSelectionDisposable = xterm.onSelectionChange(() => {
      const selection = xterm.getSelection();
      if (selection) inputManager.handleCopy(selection);
    });

    const handleDOMPaste = async (e: ClipboardEvent) => {
      e.preventDefault();
      const pastedText = await inputManager.handlePaste();
      if (pastedText) {
         inputManager.handleInput(pastedText, dockerStream);
      }
    };

    const terminalElement = terminalRef.current;
    terminalElement?.addEventListener('paste', handleDOMPaste);

    return () => {
      // Cleanup on unmount to prevent memory leaks and ghost connections
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onSelectionDisposable.dispose();
      terminalElement?.removeEventListener('paste', handleDOMPaste);
      dockerStream.disconnect();
    };
  }, [xterm, terminalRef]);

  return (
    <div style={{ width: '100%', height: '100%', padding: '10px', backgroundColor: '#1e1e1e' }}>
      <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};