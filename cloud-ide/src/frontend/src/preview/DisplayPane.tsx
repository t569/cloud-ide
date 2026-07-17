// frontend/src/preview/DisplayPane.tsx
//
// The interactive Display pane (display-streaming plan, slice 4): renders the
// sandbox's virtual X display beside the code, with full mouse + keyboard. The
// browser runs the VNC client (@novnc/novnc RFB over WebSocket); the gateway
// bridges that socket to Xvnc's RFB port inside the container. Same pane slot
// as PreviewPane — a web app previews, a GUI app displays.
//
// Flow per open/reconnect: POST /display (starts Xvnc if needed, idempotent) →
// RFB connect to /display/stream. A 409 NO_DISPLAY_STACK means the env image
// has no GUI stack — show the enable+rebuild CTA instead of a dead canvas.
import React, { useEffect, useRef, useState } from 'react';
// The package's `exports` maps its ROOT to core/rfb.js — RFB is the default export.
import RFB from '@novnc/novnc';
import { startDisplay } from '../api/sandbox';
import { ApiError } from '../lib/apiClient';
import { API_BASE_URL } from '../config/env';
import { connectAudio, type AudioHandle } from './audioStream';

interface DisplayPaneProps {
  sandboxId: string;
  onClose: () => void;
}

type PaneState =
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'no-stack' }
  | { kind: 'paused' } // off-screen / tab hidden — stream torn down to save work (O1)
  | { kind: 'error'; detail: string };

/** ws(s) URL of the gateway's RFB bridge for this sandbox. */
function streamUrl(sandboxId: string): string {
  // API_BASE_URL is http(s)://host:port/api — same origin carries the auth cookie.
  return `${API_BASE_URL.replace(/^http/, 'ws')}/v1/sandboxes/${encodeURIComponent(sandboxId)}/display/stream`;
}

export const DisplayPane = ({ sandboxId, onClose }: DisplayPaneProps) => {
  const screenRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [state, setState] = useState<PaneState>({ kind: 'connecting' });
  // Bumping this re-runs the connect effect — the Reconnect button.
  const [attempt, setAttempt] = useState(0);
  // Pause the whole stream while the pane is off-screen or the browser tab is hidden
  // (optimization store O1): a backgrounded GUI app otherwise keeps the container
  // rendering, the WS flowing, and noVNC decoding frames nobody can see. active =
  // on-screen AND tab-visible; when false we tear the RFB down and suspend audio, and
  // rebuild on return (POST /display is idempotent, so the round-trip back is cheap).
  const [active, setActive] = useState(true);
  // Audio is a SEPARATE, opt-in transport: off by default (no surprise noise,
  // no cost until asked). The toggle is the required autoplay user gesture.
  const audioRef = useRef<AudioHandle | null>(null);
  const [audioOn, setAudioOn] = useState(false);

  const toggleAudio = async () => {
    if (audioRef.current) {
      audioRef.current.stop();
      audioRef.current = null;
      setAudioOn(false);
      return;
    }
    try {
      audioRef.current = await connectAudio(sandboxId);
      setAudioOn(true);
    } catch {
      audioRef.current = null;
      setAudioOn(false); // no audio stack / tap down — stay muted, no error state
    }
  };

  // Track visibility: on-screen (IntersectionObserver on the canvas) AND tab-visible
  // (visibilitychange). Either going false pauses the stream. ponytail: immediate
  // pause/resume — add a short debounce only if rapid tab-flipping proves to thrash.
  useEffect(() => {
    const el = screenRef.current;
    let onScreen = true;
    const update = () => setActive(onScreen && !document.hidden);
    const io = new IntersectionObserver(
      ([entry]) => { onScreen = entry.isIntersecting; update(); },
      { threshold: 0.01 },
    );
    if (el) io.observe(el);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  // Suspend/resume audio in lock-step with the video pause (O1). Reads the ref live so
  // toggling audio on while active still works; no-op when audio is off.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (active) a.resume();
    else a.suspend();
  }, [active]);

  useEffect(() => {
    if (!active) {
      // Off-screen / hidden: the cleanup below already tore down any live RFB.
      setState({ kind: 'paused' });
      return;
    }
    let live = true;
    setState({ kind: 'connecting' });

    (async () => {
      try {
        await startDisplay(sandboxId); // idempotent; also revives a crashed Xvnc
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && (e.data as any)?.code === 'NO_DISPLAY_STACK') {
          setState({ kind: 'no-stack' });
        } else {
          setState({ kind: 'error', detail: (e as Error).message });
        }
        return;
      }
      if (!live || !screenRef.current) return;

      const rfb = new RFB(screenRef.current, streamUrl(sandboxId));
      rfb.scaleViewport = true; // fixed 1280x720 server-side; fit whatever the pane is
      rfb.background = '#1e1e1e';
      rfb.addEventListener('connect', () => live && setState({ kind: 'connected' }));
      rfb.addEventListener('disconnect', () => {
        // Covers pause/resume (socket dies, server survives) and Xvnc crashes —
        // the user reconnects explicitly; auto-retry loops just fight a paused box.
        if (live) setState({ kind: 'error', detail: 'Display disconnected.' });
      });
      rfbRef.current = rfb;
    })();

    return () => {
      live = false;
      rfbRef.current?.disconnect();
      rfbRef.current = null;
    };
  }, [sandboxId, attempt, active]);

  // Audio outlives video reconnects (attempt bumps) but not a sandbox swap.
  useEffect(() => {
    return () => {
      audioRef.current?.stop();
      audioRef.current = null;
    };
  }, [sandboxId]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-ide-border bg-[#1e1e1e]">
      {/* Pane chrome — matches PreviewPane's bar. */}
      <div className="flex items-center gap-2 border-b border-gray-700 bg-[#252526] px-2 py-1">
        <span className="text-xs text-gray-300">Display</span>
        <span className="flex-1 truncate text-[11px] text-gray-500">
          {state.kind === 'connected' ? 'connected — 1280×720, scaled to fit' : state.kind}
        </span>
        <button
          type="button"
          onClick={toggleAudio}
          title={audioOn ? 'Mute audio' : 'Enable audio'}
          aria-label={audioOn ? 'Mute audio' : 'Enable audio'}
          aria-pressed={audioOn}
          className={`px-1 hover:text-white ${audioOn ? 'text-white' : 'text-gray-500'}`}
        >
          {audioOn ? '🔊' : '🔇'}
        </button>
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          title="Reconnect (restarts the virtual display if it died)"
          className="px-1 text-gray-300 hover:text-white"
        >
          ⟳
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close display"
          aria-label="Close display"
          className="px-1 text-gray-300 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* The RFB canvas mounts into this div. Overlay states sit on top of it. */}
      <div className="relative min-h-0 flex-1">
        <div ref={screenRef} className="h-full w-full" />
        {state.kind !== 'connected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#1e1e1e]/95 p-6 text-center">
            {state.kind === 'connecting' && (
              <p className="text-sm text-gray-400">Starting virtual display…</p>
            )}
            {state.kind === 'paused' && (
              <p className="text-sm text-gray-400">Paused while hidden — return to resume.</p>
            )}
            {state.kind === 'no-stack' && (
              <>
                <p className="text-sm text-gray-200">This environment has no GUI display stack.</p>
                <p className="max-w-xs text-xs text-gray-500">
                  Enable “GUI display” on the environment, rebuild it, then use ⟳ Workspace
                  (top bar) to restart onto the new image — and reconnect here.
                </p>
              </>
            )}
            {state.kind === 'error' && (
              <>
                <p className="text-sm text-gray-200">{state.detail}</p>
                <button
                  onClick={() => setAttempt((n) => n + 1)}
                  className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-white/5"
                >
                  Reconnect
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
