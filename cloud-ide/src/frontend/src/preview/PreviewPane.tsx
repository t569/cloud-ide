// frontend/src/preview/PreviewPane.tsx
//
// The Preview Panel (Step 5): renders a sandboxed web app beside the code.
// Listens for PREVIEW_URL events on the shared TerminalEventBus (emitted when
// the user clicks a sniffed localhost link) and loads the proxied ingress URL
// in an iframe, with minimal browser chrome (address bar + reload).
import React, { useEffect, useRef, useState } from 'react';
import { TerminalEventBus } from '../terminal/core/TerminalEventBus';

interface PreviewPaneProps {
  eventBus: TerminalEventBus;
}

export const PreviewPane = ({ eventBus }: PreviewPaneProps) => {
  const [url, setUrl] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const unsubscribe = eventBus.on('PREVIEW_URL', ({ url }) => {
      setUrl(url);
      setAddressInput(url);
    });
    return unsubscribe;
  }, [eventBus]);

  const reload = () => {
    // Re-assigning src is the only reliable cross-origin iframe refresh
    if (iframeRef.current) iframeRef.current.src = url;
  };

  const navigate = (e: React.FormEvent) => {
    e.preventDefault();
    setUrl(addressInput);
  };

  if (!url) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm bg-[#1e1e1e]">
        Run a dev server and click its localhost link to preview it here.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full border border-gray-700 rounded overflow-hidden bg-white">
      {/* Browser chrome */}
      <form onSubmit={navigate} className="flex items-center gap-2 px-2 py-1 bg-[#252526] border-b border-gray-700">
        <button
          type="button"
          onClick={reload}
          title="Reload"
          className="text-gray-300 hover:text-white px-1"
        >
          ⟳
        </button>
        <input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          className="flex-1 bg-[#1e1e1e] text-gray-200 text-xs px-2 py-1 rounded border border-gray-600 focus:outline-none"
          spellCheck={false}
        />
      </form>

      <iframe
        ref={iframeRef}
        src={url}
        title="App Preview"
        className="flex-1 w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      />
    </div>
  );
};
