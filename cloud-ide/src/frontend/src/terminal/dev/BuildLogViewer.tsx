// frontend/src/BuildLogViewer.tsx
import React, { useEffect, useRef } from 'react'; // Removed useMemo

import { TerminalComponent, TerminalHandle } from '@frontend/terminal/components/Terminal';
import { MockBuildTransport } from '@frontend/terminal/dev/MockBuildTransport';

export const BuildLogViewer = () => {
  const terminalRef = useRef<TerminalHandle>(null);
  
  // FIXED 2: Bind the class instance to a ref so React can never garbage-collect 
  // it while the component is mounted. We extract .current immediately for clean usage.
  const buildTransport = useRef(new MockBuildTransport()).current;

  useEffect(() => {
    // This is safe even in React 18 Strict Mode double-mounts, 
    // as long as your MockBuildTransport handles rapid disconnect/reconnects.
    buildTransport.connect();
    
    return () => buildTransport.disconnect();
  }, [buildTransport]);

  const handleStartBuild = () => {
    // Clear the screen before starting a new build
    terminalRef.current?.clear(); 
    buildTransport.startMockBuild();
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#111', color: 'white', height: '100vh' }}>
      <h2>Environment Build Logs</h2>
      
      <button 
        onClick={handleStartBuild}
        style={{ marginBottom: '10px', padding: '8px 16px', background: '#0dbc79', border: 'none', cursor: 'pointer' }}
      >
        Trigger Mock Build
      </button>

      {/* The dimensions here act as a hard boundary, which the xterm ResizeObserver 
          will detect and perfectly fit the terminal inside! */}
      <div style={{ height: '400px', width: '800px', border: '1px solid #333' }}>
        <TerminalComponent 
          ref={terminalRef}
          theme="dark"
          isReadOnly={true}              // Locks the keyboard
          transport={buildTransport}     // Streams the logs
        />
      </div>
    </div>
  );
};