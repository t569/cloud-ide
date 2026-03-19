// frontend/src/terminal/components/Terminal.tsx

// this is the final terminal component encapsulating the hook from src/terminal/hooks/useTerminal.ts

// frontend/src/terminal/components/Terminal.tsx

import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useTerminal } from '../hooks/useTerminal';

// Core Logic
import { InputManager } from '../core/InputManager';
import { MiddlewarePipeline } from '../core/MiddlewarePipeline';
import { WindowsClearFix } from '../core/middlewares/WindowsClearFix';

// Strict Types
import { 
  ITransportStream, 
  ITerminalMiddleware, 
  IInputHandler, 
  ITerminalConfig 
} from '../types/terminal';
import { THEMES } from './theme';

// 1. COMBINING PROPS AND CONFIG
// We extend your ITerminalConfig so the parent can pass styling AND the backend transport
export interface TerminalProps extends ITerminalConfig {
  transport?: ITransportStream | null; // Injected dependency (e.g., SessionStream)
  isReadOnly?: boolean;                // True for Docker build logs, False for IDE
}

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
}

// TerminalProps encapsulates ITerminalConfig
export const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(({
  theme = 'dark',
  fontFamily = ' "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
  fontSize = 14,
  useWasmRepl,
  transport,
  isReadOnly = false
}, ref) => {
  
  // Logic to ensure we pass an ITheme object, not a string
  // we map the string to the list
  const resolvedTheme = typeof theme === 'string' 
    ? (THEMES[theme] || THEMES.dark) 
    : theme;

 
  // Pass the config down to your xterm.js wrapper
  const { terminalRef, xterm } = useTerminal({ theme: resolvedTheme, fontFamily, fontSize });
  
  // 2. STRICTLY TYPED REFS
  const inputHandlerRef = useRef<IInputHandler>(new InputManager());
  const pipelineRef = useRef<ITerminalMiddleware>(new MiddlewarePipeline());

  // Expose manual write/clear methods to the parent (for our EnvManager build logs)
  useImperativeHandle(ref, () => ({
    write: (data: string) => xterm?.write(data),
    clear: () => xterm?.clear()
  }));

  useEffect(() => {
    if (!xterm) return;

    const inputHandler = inputHandlerRef.current;
    const pipeline = pipelineRef.current as MiddlewarePipeline; 
    
    pipeline.use(new WindowsClearFix());

    // --- READ-ONLY MODE (Docker Build Logs) ---
    if (isReadOnly || !transport) {
      xterm.options.disableStdin = true;
      return; // Stop here. We don't wire up inputs or transports.
    }

    // --- INTERACTIVE MODE (OpenSandbox IDE) ---
    xterm.options.disableStdin = false;

    // A. Pipeline: Backend -> Middleware -> Screen
    transport.onData((rawData: string) => {
      const sanitizedData = pipeline.processIncoming(rawData);
      if (sanitizedData) xterm.write(sanitizedData);
    });

    // B. Pipeline: Screen (Typing) -> Middleware -> Transport
    const onDataDisposable = xterm.onData((data) => {
      const sanitizedOutgoing = pipeline.processOutgoing(data);
      inputHandler.handleInput(sanitizedOutgoing, transport);
    });

    // C. Handle Resizing
    const onResizeDisposable = xterm.onResize(({ cols, rows }) => {
      // Assuming your transport interface has a resize method, otherwise handle safely
      if ('resize' in transport && typeof transport.resize === 'function') {
        transport.resize(cols, rows);
      }
    });

    // D. Register OS Signals
    inputHandler.onSignal('SIGINT', () => transport.write('\x03'));
    inputHandler.onSignal('EOF', () => transport.write('\x04'));

    // E. Copy & Paste
    const onSelectionDisposable = xterm.onSelectionChange(() => {
      const selection = xterm.getSelection();
      if (selection) inputHandler.handleCopy(selection);
    });

    const handleDOMPaste = async (e: ClipboardEvent) => {
      e.preventDefault();
      const pastedText = await inputHandler.handlePaste();
      if (pastedText) {
         inputHandler.handleInput(pastedText, transport);
      }
    };

    const terminalElement = terminalRef.current;
    terminalElement?.addEventListener('paste', handleDOMPaste);

    return () => {
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      onSelectionDisposable.dispose();
      terminalElement?.removeEventListener('paste', handleDOMPaste);
    };
  }, [xterm, transport, isReadOnly]);

  return (
    <div style={{ width: '100%', height: '100%', padding: '10px', backgroundColor: theme === 'light' ? '#ffffff' : '#1e1e1e' }}>
      <div ref={terminalRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
});