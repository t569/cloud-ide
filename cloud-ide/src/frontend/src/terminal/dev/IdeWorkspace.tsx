// frontend/src/IdeWorkspace.tsx

// This file is an example of how we will connect our frontend terminal to our backend sandbox


// ------------------------------ I ------------------------------------------- //
// import React, { useState, useEffect } from 'react';
// import { TerminalComponent } from '../../terminal/components/Terminal';
// import { WebSocketTransport } from '../../terminal/transport/WebSocketTransport';

// export const IdeWorkspace = ({ envId }) => {
//   const [transport, setTransport] = useState<WebSocketTransport | null>(null);

//   useEffect(() => {
//     // 1. Call your REST API to boot the sandbox
//     fetch(`/api/v1/sandboxes`, { method: 'POST', body: JSON.stringify({ environmentId: envId }) })
//       .then(res => res.json())
//       .then(status => {
//         // 2. We got the status! Now build the WebSocket URL using the execdPort
//         // e.g., ws://api.yourdomain.com/sandboxes/sbx-8f72a9b1/pty
//         const wsUrl = `ws://${window.location.host}/api/v1/sandboxes/${status.sandboxId}/pty`;
        
//         // 3. Instantiate the transport and trigger the connection
//         const wsTransport = new WebSocketTransport(wsUrl);
//         wsTransport.connect().then(() => {
//            // 4. Pass it to the terminal!
//            setTransport(wsTransport);
//         });
//       });
//   }, [envId]);

//   return (
//     <div>
//       {/* The terminal waits until the transport is fully wired up */}
//       {transport ? (
//         <TerminalComponent theme="dark" transport={transport} />
//       ) : (
//         <p>Provisioning Sandbox environment...</p>
//       )}
//     </div>
//   );
// };

// ------------------------------   I I ------------------------------------------- //
// This implements local storage for logs

// Inside your IdeWorkspace.tsx or wherever you mount the terminal


// import React, { useEffect, useRef } from 'react';
// import { TerminalComponent, TerminalHandle } from './terminal/components/Terminal';

// export const IdeWorkspace = ({ envId }) => {
//   const terminalRef = useRef<TerminalHandle>(null);
  
//   // Create a unique storage key for this specific sandbox
//   const storageKey = `terminal-state-${envId}`;

//   useEffect(() => {
//     // 1. Restore state on mount
//     const savedState = localStorage.getItem(storageKey);
//     if (savedState && terminalRef.current) {
//        terminalRef.current.write(savedState);
//     }

//     // 2. Save state right before the tab closes or refreshes
//     const handleBeforeUnload = () => {
//       const currentState = terminalRef.current?.serializeState();
//       if (currentState) {
//         try {
//           localStorage.setItem(storageKey, currentState);
//         } catch (e) {
//           console.warn('Terminal state too large for localStorage', e);
//         }
//       }
//     };

//     window.addEventListener('beforeunload', handleBeforeUnload);

//     return () => {
//       window.removeEventListener('beforeunload', handleBeforeUnload);
//       // Optionally save on unmount as well
//       handleBeforeUnload(); 
//     };
//   }, [envId]);

//   return (
//     <TerminalComponent 
//       ref={terminalRef} 
//       theme="dark" 
//       // ... your transport and plugins
//     />
//   );
// };


// frontend/src/IdeWorkspace.tsx
import React, { useMemo } from 'react';
import { TerminalComponent } from '../../terminal/components/Terminal';
import { TerminalContextWidget } from '../../terminal/components/TerminalContextWidget';
import { TerminalEventBus } from '../../terminal/core/TerminalEventBus';
import { FileIconPlugin } from '../../terminal/core/plugins/FileIconPlugin';

// 1. IMPORT THE TYPE
import { ITransportStream } from '../../terminal/types/terminal';
import { LinkSnifferPlugin } from '../core/plugins/LinkSnifferPluggin';

// 2. DEFINE THE PROPS INTERFACE
interface IdeWorkspaceProps {
  transport?: ITransportStream | null;
  sandboxId: string;
}

// 3. APPLY THE INTERFACE TO THE COMPONENT
export const IdeWorkspace = ({ transport, sandboxId }: IdeWorkspaceProps) => {
  // 1. The Central Nervous System: Create it once per workspace
  const sharedEventBus = useMemo(() => new TerminalEventBus(), []);

  // 2. Define the plugins (the FileIconPlugin will automatically use the bus it's given)
  const plugins = useMemo(() => [
    new FileIconPlugin(),
    new LinkSnifferPlugin(),
  ], []);

  const handleContextClick = (fileName: string) => {
    console.log(`[IDE] User clicked ${fileName}. Open this in the code editor!`);
  };

  const handleLinkClick = (rawUrl: string) => {
    // 1. Extract the port from the raw URL (e.g., "http://localhost:3000" -> "3000")
    const portMatch = rawUrl.match(/:(\d{2,5})/);
    if (!portMatch) return;
    const port = portMatch[1];

    // 2. Build your proxy URL based on your backend architecture
    // Example: If your OpenSandbox assigns domains like https://3000-sbx123.yourdomain.com
    const proxiedUrl = `https://${port}-${sandboxId}.your-cloud-ide.com`;

    console.log(`[IDE Action] Intercepted ${rawUrl}. Opening split pane for ${proxiedUrl}`);
    
    // 3. Dispatch action to open the built-in browser tab in your IDE!
    // dispatch(openPreviewTab(proxiedUrl));
  };

  return (
    <div className="flex flex-col h-full w-full border border-gray-700 rounded bg-[#1e1e1e]">
      
      {/* 3A. Pass the shared bus to the UI Widget so it can listen */}
      <TerminalContextWidget 
        eventBus={sharedEventBus} 
        onFileClick={handleContextClick} 
        onLinkClick={handleLinkClick}
      />

      <div className="flex-1 overflow-hidden relative">
        {/* 3B. Pass the EXACT SAME bus to the Terminal so plugins can emit to it */}
        <TerminalComponent 
          theme="dark" 
          transport={transport} 
          plugins={plugins}
          eventBus={sharedEventBus} 
        />
      </div>
      
    </div>
  );
};