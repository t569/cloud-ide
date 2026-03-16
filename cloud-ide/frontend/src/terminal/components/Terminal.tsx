import React, { useEffect, useRef } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import { InputManager } from '../core/InputManager';

export const TerminalComponent: React.FC = () => {

    // returns to use the actual refined terminal object
  const { terminalRef, xterm } = useTerminal();

  // this keeps an instance of the InputManager that survives re-renders
  const inputManagerRef = useRef(new InputManager());


  useEffect(() => {
    if (!xterm) return;

    const inputManager = inputManagerRef.current;


    // Print a welcome message using ANSI escape codes for colors
    xterm.writeln('\x1b[1;32mCloud IDE Terminal Initialized\x1b[0m');
    xterm.write('$ ');

 
    // TEMPORARY LOCAL ECHO: Just to prove the UI works before we attach the backend
    
    // 1. handle normal typing and special characters
    const onDataDisposable = xterm.onData((data) => {
      // Right now, transport is null. When we build the Docker transport, we will pass it here.
      inputManager.handleInput(data, null);
    });

    // 2. Listen for our custom signals
    // Defines what to do on these signals
    inputManager.onSignal('SIGINT', () => {
        xterm.write('^C\r\n$ ');    // Simulate visual Cntrl+C behavior i.e write this to the terminal
    });

    inputManager.onSignal('EOF', () => {
        xterm.write('^D\r\n$ ');    // Simulate visual Cntrl+D behavior i.e. write this to the terminal
    })

    // 3. Handle Copying: Automatically copy when text is selected
    const onSelectionDisposable = xterm.onSelectionChange(() => {
    const selection = xterm.getSelection();
      if (selection) {
        inputManager.handleCopy(selection);
      }
    });

    // 4. Handle Pasting (Right-click or Ctrl+V/Cmd+V)
    const handleDOMPaste = async (e: ClipboardEvent) => {
      e.preventDefault();
      const pastedText = await inputManager.handlePaste();
      if (pastedText) {
         // Pass pasted text as input
         inputManager.handleInput(pastedText, null);
         // Local echo for now just so you can see it:
         xterm.write(pastedText); 
      }
    };

    // Attach native paste event to the terminal DOM element
    const terminalElement = terminalRef.current;
    terminalElement?.addEventListener('paste', handleDOMPaste);

    return () => {
      onDataDisposable.dispose();
      onSelectionDisposable.dispose();
      terminalElement?.removeEventListener('paste', handleDOMPaste);
    };
}, [xterm, terminalRef]);
    // const disposable = xterm.onData((data) => {
    //   // If the user presses Enter (carriage return)
    //   if (data === '\r') {
    //     xterm.write('\r\n$ ');
    //   } 
    //   // If the user presses Backspace
    //   else if (data === '\x7f') {
    //     xterm.write('\b \b');
    //   } 
    //   // Standard typing
    //   else {
    //     xterm.write(data);
    //   }
    // });

//     return () => {
//       disposable.dispose();
//     };
//   }, [xterm]);

  return (
    <div style={{ width: '100%', height: '100%', padding: '10px', backgroundColor: '#1e1e1e' }}>
      <div 
        ref={terminalRef} 
        style={{ width: '100%', height: '100%' }} 
      />
    </div>
  );
};