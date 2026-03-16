import React, { useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';

export const TerminalComponent: React.FC = () => {

    // returns to use the actual refined terminal object
  const { terminalRef, xterm } = useTerminal();

  useEffect(() => {
    if (!xterm) return;

    // Print a welcome message using ANSI escape codes for colors
    xterm.writeln('\x1b[1;32mCloud IDE Terminal Initialized\x1b[0m');
    xterm.write('$ ');

    // TEMPORARY LOCAL ECHO: Just to prove the UI works before we attach the backend
    const disposable = xterm.onData((data) => {
      // If the user presses Enter (carriage return)
      if (data === '\r') {
        xterm.write('\r\n$ ');
      } 
      // If the user presses Backspace
      else if (data === '\x7f') {
        xterm.write('\b \b');
      } 
      // Standard typing
      else {
        xterm.write(data);
      }
    });

    return () => {
      disposable.dispose();
    };
  }, [xterm]);

  return (
    <div style={{ width: '100%', height: '100%', padding: '10px', backgroundColor: '#1e1e1e' }}>
      <div 
        ref={terminalRef} 
        style={{ width: '100%', height: '100%' }} 
      />
    </div>
  );
};