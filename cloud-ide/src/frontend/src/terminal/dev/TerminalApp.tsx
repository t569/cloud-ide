// frontend/src/App.tsx (or wherever you are testing locally)
import React, { useMemo, useEffect } from 'react';
import { TerminalComponent } from '../../terminal/components/Terminal';
import { DevTransport } from '../../terminal/dev/DevTransport'; // <-- Switch to the new PTY simulator
import { FileIconPlugin } from '../../terminal/core/plugins/FileIconPlugin';
import { RepoGraphPlugin } from '../../terminal/core/plugins/RepoGraphPlugin';

export const LocalTerminalTest = () => {
  // 1. Instantiate the DevTransport (Our local Pseudo-Terminal that handles echo & backspace)
  const devTransport = useMemo(() => new DevTransport(), []);

  // 2. Connect it when the component mounts
  useEffect(() => {
    devTransport.connect();
    return () => devTransport.disconnect();
  }, [devTransport]);

  // 3. Define the plugins you want to test in the Event Bus
  const testPlugins = useMemo(() => [
    new FileIconPlugin(),
    new RepoGraphPlugin()
  ], []);

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '20px', borderBottom: '1px solid #333' }}>
        <h1 style={{ color: '#0dbc79', fontFamily: 'monospace', margin: 0 }}>~/cloud-ide (Local Dev)</h1>
        <p style={{ color: '#888', fontFamily: 'monospace', fontSize: '12px', marginTop: '5px' }}>
          Testing TTY Line Discipline & Plugin Event Bus
        </p>
      </header>
      
      {/* 4. Inject the DevTransport and plugins into your actual component */}
      <div style={{ flex: 1, padding: '20px' }}>
        <div style={{ height: '600px', width: '100%', maxWidth: '1000px', border: '1px solid #333', borderRadius: '4px', overflow: 'hidden' }}>
          <TerminalComponent 
            theme="light"
            transport={devTransport} 
            plugins={testPlugins} 
          />
        </div>
      </div>
    </div>
  );
};