// frontend/src/preview/PreviewPane.tsx
//
// The Preview Panel (Step 5): renders a sandboxed web app beside the code, as a little
// browser. The iframe points at the gateway's SUBDOMAIN ingress
// (`<sandboxId>-<port>.<host>/…?__cide_pt=…`) — a sandbox has no address the browser can
// reach directly, and a subdomain (not a `/preview/…` path) so the app's root-absolute
// assets and HMR socket resolve correctly.
//
// The address bar speaks the PRETTY form the user thinks in — `localhost:8000/docs` — and
// resolves it to the actual subdomain URL on navigate (see devUrl). The real exposed host
// is shown beneath, on a tooltip and a subline. Because the iframe is cross-origin we can't
// read where the app has navigated internally; the bar is for driving it (open /docs, switch
// ports), and each navigation mints a FRESH token — which changes the URL, so the iframe
// reliably reloads even when the target path is unchanged (that is also the Reload button).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPreviewToken } from '../api/sandbox';
import { API_BASE_URL } from '../config/env';
import {
  toPreviewUrl,
  fromPreviewUrl,
  prettyToLocalhostUrl,
  isExternalWebUrl,
} from '../terminal/core/devUrl';

interface PreviewPaneProps {
  sandboxId: string;
  /** Subdomain ingress URL, e.g. http://<sandboxId>-5173.localhost:3000/?__cide_pt=… */
  url: string;
  onClose: () => void;
}

// API_BASE_URL ends in /api; the gateway (and its preview subdomains) live at the root.
const gatewayOrigin = () => API_BASE_URL.replace(/\/api$/, '');
const hostOf = (u: string): string => {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
};

export const PreviewPane = ({ sandboxId, url, onClose }: PreviewPaneProps) => {
  const initial = fromPreviewUrl(url);
  const [pretty, setPretty] = useState(initial?.pretty ?? url);
  const [port, setPort] = useState(initial?.port ?? 80);
  const [src, setSrc] = useState(url);
  const [exposedHost, setExposedHost] = useState(() => hostOf(url));
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Bookmarks: user-curated shortcuts (a `localhost:8000/docs` or an external URL),
  // persisted per-browser — general, not per-sandbox. Surfaced as the address bar's
  // native dropdown (datalist); the star toggles the CURRENT address in/out.
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('cide.preview.bookmarks') || '[]');
      return Array.isArray(raw) ? raw.filter((b) => typeof b === 'string') : [];
    } catch {
      return [];
    }
  });
  const isBookmarked = bookmarks.includes(pretty);
  const toggleBookmark = () => {
    setBookmarks((prev) => {
      const next = prev.includes(pretty) ? prev.filter((b) => b !== pretty) : [...prev, pretty];
      try {
        localStorage.setItem('cide.preview.bookmarks', JSON.stringify(next));
      } catch {
        /* storage full / disabled — bookmarks are best-effort */
      }
      return next;
    });
  };

  // A new server (a different sniffed port) or a reopen replaces what's on screen.
  useEffect(() => {
    const p = fromPreviewUrl(url);
    setPretty(p?.pretty ?? url);
    setPort(p?.port ?? 80);
    setSrc(url);
    setExposedHost(hostOf(url));
  }, [url]);

  // Resolve a pretty target to the actual subdomain src (with a fresh token) and load it.
  const load = useCallback(
    async (prettyTarget: string) => {
      const t = prettyTarget.trim();
      // A full external http(s):// URL browses there directly — no sandbox proxy, no token.
      // Whether it renders is the target site's frame policy, not ours. Sandbox ports (below)
      // still go through the ingress.
      if (isExternalWebUrl(t)) {
        setPretty(t);
        setExposedHost(`${hostOf(t)} · external`);
        setSrc(t);
        return;
      }
      const localhostUrl = prettyToLocalhostUrl(t, port);
      if (!localhostUrl) return;
      try {
        const { token } = await getPreviewToken(sandboxId);
        const actual = toPreviewUrl(localhostUrl, sandboxId, gatewayOrigin(), token);
        if (!actual) return;
        const back = fromPreviewUrl(actual); // canonicalise the bar + track the current port
        if (back) {
          setPretty(back.pretty);
          setPort(back.port);
        }
        setExposedHost(hostOf(actual));
        setSrc(actual); // fresh token ⇒ new URL ⇒ the iframe reloads
      } catch (e) {
        console.error('[Preview] navigation failed', e);
      }
    },
    [sandboxId, port],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void load(pretty);
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-ide-border bg-white">
      {/* Browser chrome */}
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-b border-gray-700 bg-[#252526] px-2 py-1"
      >
        <button
          type="button"
          onClick={() => void load(pretty)}
          title="Reload"
          className="px-1 text-gray-300 hover:text-white"
        >
          ⟳
        </button>
        <input
          value={pretty}
          onChange={(e) => setPretty(e.target.value)}
          placeholder="localhost:8000/docs"
          spellCheck={false}
          list="preview-bookmarks"
          title={exposedHost ? `Exposed at ${exposedHost}` : undefined}
          className="flex-1 rounded border border-gray-600 bg-[#1e1e1e] px-2 py-1 text-xs text-gray-200 focus:outline-none"
        />
        {/* Saved shortcuts appear as the address bar's native dropdown. */}
        <datalist id="preview-bookmarks">
          {bookmarks.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={toggleBookmark}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this address'}
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this address'}
          aria-pressed={isBookmarked}
          className={`px-1 ${isBookmarked ? 'text-amber-400' : 'text-gray-500 hover:text-white'}`}
        >
          {isBookmarked ? '★' : '☆'}
        </button>
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

      {/* The actual exposed URL, so the pretty bar isn't a black box. */}
      {exposedHost && (
        <div
          className="truncate border-b border-gray-800 bg-[#1e1e1e] px-2 py-0.5 text-[10px] text-gray-500"
          title={src}
        >
          exposed: {exposedHost}
        </div>
      )}

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
