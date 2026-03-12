import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css'; // Don't forget the CSS!

export default function TerminalComponent() {
  const terminalRef = useRef(null);

  useEffect(() => {
    // 1. Initialize Terminal
    const term = new Terminal({
      theme: { background: '#1e1e1e', foreground: '#cccccc' },
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
    });

    // 2. Initialize Fit Addon
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // 3. Mount to the DOM
    term.open(terminalRef.current);
    fitAddon.fit();

    // 4. Print initial text
    term.writeln('\x1b[1;32mWelcome to the Browser IDE Terminal!\x1b[0m');
    term.write('$ ');

    // 5. Very basic keystroke echo (fake terminal behavior for now)
    term.onData((data) => {
      const code = data.charCodeAt(0);
      if (code === 13) { // Enter key
        term.writeln('');
        term.write('$ ');
      } else if (code === 127) { // Backspace
        term.write('\b \b');
      } else {
        term.write(data);
      }
    });

    // Handle window resize dynamically
    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    // Cleanup on unmount
    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  return <div ref={terminalRef} style={{ height: '100%', width: '100%', overflow: 'hidden' }} />;
}