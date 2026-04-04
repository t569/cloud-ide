// frontend/src/terminal/hooks/useTerminal.ts

/* this file defines the core xterm.js terminal that has been wrapped in logic and is injected to our terminal object
*  see src/terminal/components/Terminal.tsx
*/

import { useEffect, useRef, useState } from 'react';
import { ITheme, Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css'; 


interface TerminalUIProps {
  theme: ITheme; // Using a union type for specific string values
  fontFamily: string;
  fontSize: number;
}
export const useTerminal = ({theme, fontFamily, fontSize}: TerminalUIProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  // We use state here so the React component knows when the terminal is ready
  const [xterm, setXterm] = useState<Terminal | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: fontFamily,
      fontSize: fontSize,
      theme: theme
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    
    setTimeout(() => fitAddon.fit(), 0);

    setXterm(term); // Trigger the re-render

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose(); 
    };
  }, []);

  // This runs whenever the theme prompt changes
  useEffect(() => {
    if(xterm) {
      xterm.options.theme = theme;
    }
  }, [theme, xterm]);   


  // Return the state variable directly, no 'xtermRef' involved
  return { terminalRef, xterm };
};