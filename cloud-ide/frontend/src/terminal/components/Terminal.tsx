// frontend/src/terminal/components/Terminal.tsx

// this is the final terminal component encapsulating the hook from src/terminal/hooks/useTerminal.ts

// TODO: line 30 down

import React, { useEffect, useRef } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import { InputManager } from '../core/InputManager';
import { MiddlewarePipeline } from '../core/MiddlewarePipeline';
import { WindowsClearFix } from '../core/middlewares/WindowsClearFix';

import { SessionStream } from '../transport/SessionStream'; 

// define terminal props that we send to the backend
// this includes: sessionId, envId, repoUrl
interface TerminalProps {
  sessionId: string;
  envId: string;
  repoUrl: string;    //i think this is for the backend to pull
}

// we pass these props into our component
export const TerminalComponent: React.FC<TerminalProps> = ({
  sessionId,
  envId,
  repoUrl
}) => {

  const { terminalRef, xterm } = useTerminal();
  
  // Persist our core logic managers across React renders
  const inputManagerRef = useRef(new InputManager());
  const pipelineRef = useRef(new MiddlewarePipeline());
  const transportRef = useRef<SessionStream | null>(null);

  useEffect(() => {
    if (!xterm) return;

    const inputManager = inputManagerRef.current;
    const pipeline = pipelineRef.current;
    
    // Register our middlewares
    pipeline.use(new WindowsClearFix());

    // 1. Initialise the SessionStream with our props and not hardcoded strings
    const sessionStream = new SessionStream(sessionId, envId, repoUrl);
    transportRef.current = sessionStream;


    // 2. Make the connection to the backend session based on the ino we just passed
    sessionStream.connect().then(() => {
       xterm.writeln('\x1b[1;32m[+] Connected to Session\x1b[0m');   // TODO: we can give better messages later

       // Tell the backend our starting terminal dimensions inside the success block
       sessionStream.resize(xterm.cols, xterm.rows);
    }).catch(err => {
       xterm.writeln('\x1b[1;31m[-] Failed to connect to backend\x1b[0m');
    });
     


    // 3. Data Pipeline: FROM Backend (Transport response) -> Middleware -> Screen
    sessionStream.onData((rawData) =>{
      const sanitizedData = pipeline.processIncoming(rawData);

      // we get something back
      if(sanitizedData)
      {
        xterm.write(sanitizedData);
      }
    });



    // 4. Data Pipeline: FROM Screen (Typing) -> Middleware -> Transport
    const onDataDisposable = xterm.onData((data) => {

      // sanitise the data first (work on it with all our middlewares)
      const sanitizedOutgoing = pipeline.processOutgoing(data);

      // Pass the sessionStream to the InputManager so it can route the data
      inputManager.handleInput(sanitizedOutgoing, sessionStream);
    });



    // 5. Handle terminal resizing (when our browser window shrinks or grows)
    const onResizeDisposable= xterm.onResize(({cols, rows}) => {
      sessionStream.resize(cols, rows);
    });


    // 6. Register our input manager OS Signals
    inputManager.onSignal('SIGINT', () =>
    {
      // simply send the hex code for Cntrl+C to the backend
      sessionStream.write('\x03');
    });
    inputManager.onSignal('EOF', () => {
      // Send the actual Ctrl+D hex code to the backend
      sessionStream.write('\x04');
    });

    // 7. Copy & Paste
    const onSelectionDisposable = xterm.onSelectionChange(() => {
      const selection = xterm.getSelection();
      if (selection) inputManager.handleCopy(selection);
    });

    const handleDOMPaste = async (e: ClipboardEvent) => {
      e.preventDefault();
      const pastedText = await inputManager.handlePaste();
      if (pastedText) {
         inputManager.handleInput(pastedText, sessionStream);
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
      

      // safely disonnect the correct stream
      if(transportRef.current){
        transportRef.current.disconnect();
      }
    };
  }, [xterm, terminalRef, sessionId, envId, repoUrl]);

  return (
    <div style={{ width: '100%', height: '100%', padding: '10px', backgroundColor: '#1e1e1e' }}>
      <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};