// frontend/src/terminal/hooks/useTerminal.ts

/* this file defines the core xterm.js terminal that has been wrapped in logic and is injected to our terminal object
*  see src/terminal/components/Terminal.tsx
*/

import { useEffect, useRef, useState } from 'react';
import { ITheme, Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css'; 


interface TerminalUIProps {
  theme: ITheme; // Using a union type for specific string values
  fontFamily: string;
  fontSize: number;
  initialState?: string;  // serialisation restore (for saving sessions)
}
export const useTerminal = ({theme, fontFamily, fontSize, initialState}: TerminalUIProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  // We use state here so the React component knows when the terminal is ready
  const [xterm, setXterm] = useState<Terminal | null>(null);


  // Expose these addons so the parent UI can trigger searches or saves
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);


  useEffect(() => {
    if (!terminalRef.current) return;

    // 1. Core initialisation
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: fontFamily,
      fontSize: fontSize,
      theme: theme
    });


    // 2. Instantiate Addons
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon();

    // Store refs for parent access
    searchAddonRef.current = searchAddon;
    serializeAddonRef.current = serializeAddon;

    // 3. Load standard addons BEFORE opening
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(serializeAddon);
    term.loadAddon(webLinksAddon); // Automatically makes URLs clickable!
    term.open(terminalRef.current);

    // 4. Attach to DOM
    term.open(terminalRef.current);

    // 5. High-Performance GPU Rendering Makes rendering thousands of lines easy to do (crisp frame rates)
    // WebGL MUST be loaded after term.open()
    try {
      const webglAddon = new WebglAddon();
      
      // Fallback gracefully if the user's browser/GPU drops the context
      webglAddon.onContextLoss(() => {
        console.warn('[Terminal] WebGL context lost. Falling back to canvas rendering.');
        webglAddon.dispose();
      });
      
      term.loadAddon(webglAddon);
    } catch (error) {
      console.warn('[Terminal] WebGL failed to load. Falling back to DOM/Canvas rendering.', error);
    }

    // 6. State Persistence Restoration (for saving sessions)
    if(initialState){
      term.write(initialState);
    }
    
    setTimeout(() => fitAddon.fit(), 0);

    setXterm(term); // Trigger the re-render

    const handleResize = () => fitAddon.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose(); 
    };
  }, []);   // Run once on mount


  // This runs whenever the theme prompt changes
  useEffect(() => {
    if(xterm) {
      xterm.options.theme = theme;
    }
  }, [theme, xterm]);   


  // Return the state variable directly, no 'xtermRef' involved
  return { terminalRef,
           xterm,
          searchAddon: searchAddonRef.current,
          serializeAddon: serializeAddonRef.current
         };
};