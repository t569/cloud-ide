// frontend/src/terminal/components/Terminal.tsx

// this is the final terminal component encapsulating the hook from src/terminal/hooks/useTerminal.ts

import '@xterm/xterm/css/xterm.css';
import React, { useEffect, useRef,
               useImperativeHandle, forwardRef, useMemo } from 'react';
import { useTerminal } from '../hooks/useTerminal';

// Core Logic
import { InputManager } from '../core/InputManager';
import { MiddlewarePipeline } from '../core/MiddlewarePipeline';
import { WindowsClearFix } from '../core/middlewares/WindowsClearFix';
import { CommandSnifferMiddleware } from '../core/middlewares/CommandSnifferMiddleware';

// Strict Types
import { 
  ITransportStream, 
  ITerminalMiddleware, 
  IInputHandler, 
  ITerminalConfig 
} from '../types/terminal';

// Themes
import { resolveTheme, BuiltInTheme } from './theme';
import { ITheme } from '@xterm/xterm';

// Terminal Event Handler
import { ITerminalPlugin, TerminalEventBus } from '../core/TerminalEventBus';

/**
 * ============================================================================
 * ☁️ CLOUD IDE: TERMINAL ARCHITECTURE & IMPLEMENTATION GUIDE
 * ============================================================================
 * * This module provides a highly decoupled, event-driven terminal interface 
 * powered by xterm.js. It is designed using the Ports and Adapters (Hexagonal) 
 * architecture to strictly separate the UI rendering from the backend execution 
 * environments (e.g., OpenSandbox, Docker, local WASM).
 * * --- CORE LAYERS ---
 * * 1. Presentation Layer (The "Dumb" UI)
 * - `Terminal.tsx`: The React wrapper. Handles DOM mounting and CSS.
 * - `useTerminal.ts`: Manages the xterm.js instance, WebGL GPU rendering, 
 * and quality-of-life addons (Search, WebLinks, Serialize).
 * * 2. Event Kernel (The Plugin System)
 * - `TerminalEventBus.ts`: A strictly-typed Pub/Sub system. 
 * Plugins (like knowledge graph builders or UI updaters) listen here 
 * to react to terminal events asynchronously without blocking the main UI thread.
 * * 3. Protocol Layer (Data Mutation)
 * - `MiddlewarePipeline.ts`: Sanitizes data between the UI and the backend. 
 * - `CommandSnifferMiddleware.ts`: Intercepts keystrokes to broadcast complete 
 * commands to the EventBus when the user presses Enter.
 * * 4. Infrastructure Layer (The PTY Bridge)
 * - `ITransportStream`: The master interface. The UI only speaks to this.
 * - `WebSocketTransport.ts`: The production implementation. Handles binary 
 * ArrayBuffers, exponential backoff reconnection, and multiplexed JSON 
 * control messages (like terminal resizing).
 * * * --- IMPLEMENTATION CHECKLIST FOR PARENT COMPONENTS ---
 * * To implement this terminal in a workspace, follow this lifecycle:
 * * [ ] 1. Boot the Sandbox: Call the backend REST API (`POST /api/v1/sandboxes`) 
 * to provision the environment and retrieve the `execdPort`.
 * * [ ] 2. Initialize Transport: Instantiate `new WebSocketTransport(wsUrl)` 
 * using the returned port, and call `transport.connect()`.
 * * [ ] 3. Mount the UI: Pass the connected transport into `<TerminalComponent />`. 
 * If tailing build logs, set `isReadOnly={true}`.
 * * [ ] 4. Manage State (Refresh Protection): 
 * - On Mount: Read from `localStorage` and call `ref.current.write()`.
 * - On Unmount/Refresh: Call `ref.current.serializeState()` and save 
 * it back to `localStorage` using the `beforeunload` event.
 * * --- ADDING NEW AUTOMATED EVENTS ---
 * Do not modify the React components to add side-effects. Instead:
 * 1. Define the exact event payload in `TerminalEventPayloads` (`TerminalEventBus.ts`).
 * 2. Create a new class implementing `ITerminalPlugin`.
 * 3. Pass it into the `plugins` array prop on the `<TerminalComponent />`.
 * ============================================================================
 */



// 1. COMBINING PROPS AND CONFIG
// We extend your ITerminalConfig so the parent can pass styling AND the backend transport
export interface TerminalProps extends Omit<ITerminalConfig, 'theme'> {
  theme?: BuiltInTheme | ITheme;        // A theme we knwo or a completely new theme
  transport?: ITransportStream | null; // Injected dependency (e.g., SessionStream)
  isReadOnly?: boolean;                // True for Docker build logs, False for IDE
  plugins?: ITerminalPlugin[];          // Inject plugins for our terminal
  eventBus?: TerminalEventBus           // accepts a terminal event bus for listening on our terminal
}

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;

  findNext: (keyword: string) => void;
  findPrevious: (keyword: string) => void;

  // Remember to implement local storage for this in parent component
  // for more info look at dev/TerminalApp.tsx
  serializeState: () => string | undefined;
  
  // for copy and paste
  getSelection: () => string;
  scrollToBottom: () => void;
}

// TerminalProps encapsulates ITerminalConfig
export const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(({
  // default values 
  theme = 'dark',
  fontFamily = '"JetBrains Mono", Consolas, Menlo, Monaco, "Courier New", monospace',
  fontSize = 14,
  transport,
  isReadOnly = false,
  plugins=[],
  eventBus: externalEventBus
}, ref) => {
  
  // Theme Resolution
  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);
  

  // Initialise the Event Bus once per terminal instance
  const eventBus = useMemo(() => {
    const bus = externalEventBus || new TerminalEventBus();
    plugins.forEach(plugin => bus.registerPlugin(plugin));
    return bus;
  }, [plugins, externalEventBus]);


  // Pass the config down to your xterm.js wrapper
  const { terminalRef, xterm, searchAddon, serializeAddon } = useTerminal({ 
    theme: resolvedTheme,
    fontFamily,
    fontSize,
    eventBus,
    // --- ADD THESE NEW POLISH SETTINGS ---
    lineHeight: 1.2,        // Adds vertical breathing room between lines
    cursorBlink: true,      // Makes the cursor blink like a real terminal
    cursorStyle: 'block',   // Options: 'block', 'underline', or 'bar'
    fontWeight: '500'       // Makes the text slightly crisper
  }); // Temporarily use 'as any' to bypass TS if your hook interface doesn't have these yet
  
  // 2. STRICTLY TYPED REFS
  const inputHandlerRef = useRef<IInputHandler>(new InputManager());
  const pipelineRef = useRef<ITerminalMiddleware>(new MiddlewarePipeline());

  // Expose manual write/clear methods to the parent (for our EnvManager build logs)
 useImperativeHandle(ref, () => ({
    write: (data: string) => xterm?.write(data),
    clear: () => xterm?.clear(),
    findNext: (keyword: string) => searchAddon?.findNext(keyword),
    findPrevious: (keyword: string) => searchAddon?.findPrevious(keyword),
    serializeState: () => serializeAddon?.serialize(),
    getSelection: () => xterm?.getSelection() || '', // <--- ADDED
    scrollToBottom: () => xterm?.scrollToBottom() 
  }));
  

  useEffect(() => {
    if (!xterm) return;

    const inputHandler = inputHandlerRef.current;
    const pipeline = pipelineRef.current as MiddlewarePipeline; 

    // Clear existing middlewares if re-running effect to prevent duplicates
    pipeline.clear(); // Add a clear() method to your MiddlewarePipeline class
    
    pipeline.use(new WindowsClearFix());
    pipeline.use(new CommandSnifferMiddleware(eventBus)); // <--- Connect the sniffer


    // ==========================================
    // NEW: CUSTOM KEYBOARD SHORTCUTS (Search UI)
    // ==========================================
    xterm.attachCustomKeyEventHandler((e) => {
      // Intercept Ctrl+F (Windows/Linux) or Cmd+F (Mac) on keydown
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF' && e.type === 'keydown') {
        e.preventDefault(); // Stop the browser's native search bar from appearing
        
        // Broadcast the event to the Search Widget
        eventBus.emit('UI_TOGGLE_SEARCH', { isVisible: true });
        
        return false; // Tell xterm.js we handled this keystroke (do not write to buffer)
      }
      
      // Allow the user to press ESC to close the search widget while focused on the terminal
      if (e.code === 'Escape' && e.type === 'keydown') {
        eventBus.emit('UI_TOGGLE_SEARCH', { isVisible: false });
      }

      return true; // Let all other keys pass through normally
    });



    // We need to define a workflow to allow for readonly terminals

    // 1. If there's no transport at all, we can't do anything. Stop here.
    if(!transport) return;

    // Lock or unlock the keyboard based on the prop
    xterm.options.disableStdin = isReadOnly;

    // A. Pipeline: Backend -> Middleware -> Screen
    // This always happens, we need to see what our backend is telling us
    transport.onData((rawData: string) => {
      const sanitizedData = pipeline.processIncoming(rawData);
      if (sanitizedData) xterm.write(sanitizedData);
    });

    // 4. ONLY Pipeline: Screen (Typing) -> Middleware -> Transport
    let onDataDisposable: { dispose: () => void } | undefined;
    let onSelectionDisposable: { dispose: () => void } | undefined;


    // ------ INTERACTIVE MODE ------ //
    if (!isReadOnly) {
      onDataDisposable = xterm.onData((data) => {
        const sanitizedOutgoing = pipeline.processOutgoing(data);
        inputHandler.handleInput(sanitizedOutgoing, transport);
      });

      onSelectionDisposable = xterm.onSelectionChange(() => {
        const selection = xterm.getSelection();
        if (selection) inputHandler.handleCopy(selection);
      });

      inputHandler.onSignal('SIGINT', () => transport.write('\x03'));
      inputHandler.onSignal('EOF', () => transport.write('\x04'));
    }

    

    // C. Handle Resizing
    const onResizeDisposable = xterm.onResize(({ cols, rows }) => {
      // Assuming your transport interface has a resize method, otherwise handle safely
      if ('resize' in transport && typeof transport.resize === 'function') {
        transport.resize(cols, rows);
      }
    });

    // D. Handle Pasting
    const handleDOMPaste = async (e: ClipboardEvent) => {
      if (isReadOnly) return;
      e.preventDefault();
      const pastedText = await inputHandler.handlePaste();
      if (pastedText) {
         inputHandler.handleInput(pastedText, transport);
         xterm?.scrollToBottom(); // <--- Snaps viewport to the bottom on paste
      }
    };

    const terminalElement = terminalRef.current;
    terminalElement?.addEventListener('paste', handleDOMPaste);

    return () => {
      onDataDisposable?.dispose();
      onResizeDisposable.dispose();
      onSelectionDisposable?.dispose();
      terminalElement?.removeEventListener('paste', handleDOMPaste);
    };
  }, [xterm, transport, isReadOnly, eventBus]);

  // 2. Dynamic Container Styling
  return (
    <div style={{ 
      width: '100%', 
      height: '100%', 
      padding: '10px', 
      boxSizing: 'border-box',
      // Safely fall back to black if the theme object is missing a background string
      backgroundColor: resolvedTheme.background || '#000000' 
    }}>
      <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
});