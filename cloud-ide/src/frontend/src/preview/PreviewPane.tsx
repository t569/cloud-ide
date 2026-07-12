// frontend/src/preview/PreviewPane.tsx
//
// The Preview Panel (Step 5): renders a sandboxed web app beside the code.
// The URL points at the Gateway's ingress proxy (/preview/:sandboxId/:port/), which
// resolves a host-routable endpoint for that port inside the container — a sandbox
// has no address the browser can reach directly.
//
// Driven by a plain prop, not the TerminalEventBus: the only producer is the
// workspace that renders this, and a bus hop between a parent and its own child
// bought nothing but a subscription to get wrong (each TerminalPanel makes its own
// isolated bus, so the event never reached here).
import React, { useRef, useState, useEffect } from 'react';

interface PreviewPaneProps {
  /** Proxied ingress URL, e.g. http://localhost:3000/preview/<sandboxId>/5173/ */
  url: string;
  onClose: () => void;
}

export const PreviewPane = ({ url, onClose }: PreviewPaneProps) => {
  const [addressInput, setAddressInput] = useState(url);
  const [src, setSrc] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // A new server (a different sniffed port) replaces what's on screen.
  useEffect(() => {
    setAddressInput(url);
    setSrc(url);
  }, [url]);

  const reload = () => {
    // Re-assigning src is the only reliable cross-origin iframe refresh
    if (iframeRef.current) iframeRef.current.src = src;
  };

  const navigate = (e: React.FormEvent) => {
    e.preventDefault();
    setSrc(addressInput);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-ide-border bg-white">
      {/* Browser chrome */}
      <form onSubmit={navigate} className="flex items-center gap-2 border-b border-gray-700 bg-[#252526] px-2 py-1">
        <button type="button" onClick={reload} title="Reload" className="px-1 text-gray-300 hover:text-white">
          ⟳
        </button>
        <input
          value={addressInput}
          onChange={(e) => setAddressInput(e.target.value)}
          className="flex-1 rounded border border-gray-600 bg-[#1e1e1e] px-2 py-1 text-xs text-gray-200 focus:outline-none"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={onClose}
          title="Close preview"
          aria-label="Close preview"
          className="px-1 text-gray-400 hover:text-white"
        >
          ✕
        </button>
      </form>

      <iframe
        ref={iframeRef}
        src={src}
        title="App Preview"
        className="w-full flex-1 border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
      />
    </div>
  );
};
