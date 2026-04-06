// frontend/src/terminal/hooks/useTerminal.ts

/**
 * @fileoverview Core xterm.js integration hook.
 * This file serves as the low-level bridge between React and the vanilla JS xterm.js library.
 * It handles DOM mounting, GPU acceleration, addon management, and bulletproof resize math.
 * * @see src/terminal/components/Terminal.tsx for the UI presentation layer that consumes this hook.
 */

import { useEffect, useRef, useState } from 'react';
import { FontWeight, ITheme, Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { SerializeAddon } from '@xterm/addon-serialize';
import { IdeLinkProvider } from '../providers/IdeLinkProvider';
import { TerminalEventBus } from '../core/TerminalEventBus';
import '@xterm/xterm/css/xterm.css'; 

/**
 * Configuration properties for the underlying xterm.js canvas.
 */
interface TerminalUIProps {
  /** The color palette applied to the terminal. */
  theme: ITheme; 
  /** A valid CSS font-family string (e.g., '"JetBrains Mono", monospace'). */
  fontFamily: string;
  /** Font size in pixels. */
  fontSize: number;
  /** An optional serialized string to restore a previous terminal session's output. */
  initialState?: string;  
  /** The central event bus used to broadcast link clicks and other UI events. */
  eventBus: TerminalEventBus; 
  /** Vertical spacing between lines. 1.2 to 1.3 is recommended for readability. */
  lineHeight?: number;
  /** Whether the cursor should blink, mimicking native terminal behavior. */
  cursorBlink?: boolean;
  /** The shape of the cursor. */
  cursorStyle?: 'block' | 'underline' | 'bar';
  /** The CSS font-weight for standard text. */
  fontWeight?: FontWeight;
}

/**
 * A custom React hook that initializes, manages, and cleans up an xterm.js instance.
 * * @param {TerminalUIProps} props - Configuration for the terminal appearance and behavior.
 * @returns An object containing the DOM ref to attach to, the terminal instance, and exposed addons.
 */
export const useTerminal = ({
  theme,
  fontFamily,
  fontSize,
  initialState,
  eventBus,
  lineHeight = 1.2,
  cursorBlink = true,
  cursorStyle = 'block',
  fontWeight = '500'
  }: TerminalUIProps) => {
  
  /** Ref attached to the physical DOM element that will host the canvas. */
  const terminalRef = useRef<HTMLDivElement>(null);
  
  /** State holding the active terminal instance. Triggers a re-render so parents know it's ready. */
  const [xterm, setXterm] = useState<Terminal | null>(null);

  /** Refs to expose specific xterm addons to the parent component for imperative control. */
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);

  useEffect(() => {
    // Abort if the target div hasn't been painted by React yet
    if (!terminalRef.current) return;

    // ==========================================
    // 1. Core Initialization
    // ==========================================
    const term = new Terminal({
      theme: theme,
      fontFamily: fontFamily,
      fontSize: fontSize,
      lineHeight: lineHeight,
      cursorBlink: cursorBlink,
      cursorStyle: cursorStyle,
      fontWeight: fontWeight,
      // UX Polish: Allows Mac users to alt-click to block-select text
      macOptionClickForcesSelection: true,
      // Data Sanitization: Converts generic newlines to proper carriage returns
      convertEol: true,
      // Performance/Memory: Defines how many lines of history to keep before truncating
      scrollback: 5000,     
      // UX Polish: Automatically scrolls the view to the bottom if the user starts typing
      scrollOnUserInput: true   
    });

    // ==========================================
    // 2. Instantiate & Load Addons
    // ==========================================
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon();

    // Store refs for parent access (e.g., allowing Ctrl+F to trigger the searchAddon)
    searchAddonRef.current = searchAddon;
    serializeAddonRef.current = serializeAddon;

    // Load standard addons BEFORE opening the terminal in the DOM
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(serializeAddon);
    term.loadAddon(webLinksAddon); // Parses http:// strings into clickable elements

    // Hook our custom link provider into the EventBus so the React UI can react to clicks
    term.registerLinkProvider(new IdeLinkProvider(term, eventBus));

    // ==========================================
    // 3. Attach to DOM
    // ==========================================
    // This injects the internal xterm grids/canvases into our React div
    term.open(terminalRef.current);

    // ==========================================
    // 4. High-Performance GPU Rendering
    // ==========================================
    // WebGL MUST be loaded AFTER term.open(). It dramatically improves framerates
    // when outputting thousands of lines (like a heavy npm install or docker build).
    try {
      const webglAddon = new WebglAddon();
      
      // Fallback gracefully to DOM/Canvas rendering if the user's browser/GPU drops the context
      webglAddon.onContextLoss(() => {
        console.warn('[Terminal] WebGL context lost. Falling back to canvas rendering.');
        webglAddon.dispose();
      });
      
      term.loadAddon(webglAddon);
    } catch (error) {
      console.warn('[Terminal] WebGL failed to load. Falling back to DOM/Canvas rendering.', error);
    }

    // ==========================================
    // 5. State Persistence Restoration
    // ==========================================
    if(initialState){
      term.write(initialState);
    }
    
    // Set state to notify React that the terminal is fully mounted
    setXterm(term); 

    // ==========================================
    // 6. Bulletproof Dimension Math
    // ==========================================
    // We use a ResizeObserver instead of window.addEventListener('resize').
    // This watches the *exact pixel height* of the container, fixing bugs where 
    // flexbox layouts change without the window itself resizing.
    const resizeObserver = new ResizeObserver(() => {
      // requestAnimationFrame prevents browser "ResizeObserver loop limit exceeded" errors
      requestAnimationFrame(() => {
        if (term.element && terminalRef.current) {
          try {
            fitAddon.fit();
          } catch (e) {
            // Failsafe in case the terminal unmounts mid-frame
            console.debug('[Terminal] Skipped fit check due to unmount context.');
          }
        }
      });
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    // ==========================================
    // 7. Cleanup Phase
    // ==========================================
    return () => {
      resizeObserver.disconnect(); 
      term.dispose(); // Destroys the canvas, webgl context, and clears memory
    };
  }, [eventBus]);


  // ==========================================
  // Dynamic Theme Updates
  // ==========================================
  // This separate effect ensures that changing the theme doesn't force a full 
  // terminal teardown and remount, which would destroy the text buffer.
  useEffect(() => {
    if(xterm) {
      xterm.options.theme = theme;
    }
  }, [theme, xterm]);   


  return { 
    terminalRef,
    xterm,
    searchAddon: searchAddonRef.current,
    serializeAddon: serializeAddonRef.current
  };
};