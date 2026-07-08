// frontend/src/terminal/hooks/useSessionPersistence.ts
//
// Gap B (client side): the durable replacement for the localStorage save/restore
// pattern described in Terminal.tsx's docblock. It drives the EXISTING
// TerminalHandle seam — serializeState() out, write() back in — against the
// backend session store, so scrollback survives a browser wipe, a device switch,
// or a gateway restart (localStorage survives none of those).
//
// No new terminal wiring: activates only when a sessionKey (`<sandboxId>:<terminalId>`)
// is provided, and is a no-op otherwise (e.g. ephemeral build-log terminals).
import { useEffect } from 'react';
import type { RefObject } from 'react';
import { apiClient } from '../../lib/apiClient';
import type { TerminalHandle } from '../components/Terminal';

// ponytail: fixed 10s cadence. If terminals get chatty enough that this is
// wasteful, gate the POST on "changed since last snapshot".
const SNAPSHOT_INTERVAL_MS = 10_000;

export function useSessionPersistence(
  termRef: RefObject<TerminalHandle | null>,
  sessionKey?: string,
): void {
  useEffect(() => {
    if (!sessionKey) return;
    const [sandboxId, terminalId] = sessionKey.split(':');
    if (!sandboxId || !terminalId) return;

    const id = encodeURIComponent(sandboxId);
    const tid = encodeURIComponent(terminalId);
    let cancelled = false;

    // Restore: pull the last snapshot and replay it into the fresh xterm.
    apiClient
      .get<{ scrollback?: string } | null>(`/fs/${id}/session?terminalId=${tid}`)
      .then((snap) => {
        if (!cancelled && snap?.scrollback) termRef.current?.write(snap.scrollback);
      })
      .catch(() => {}); // best-effort — no snapshot yet is the normal first-run case

    // Pooling save: snapshot on an interval + on page teardown, never per key.
    const save = () => {
      const scrollback = termRef.current?.serializeState();
      if (!scrollback) return;
      // keepalive lets the beforeunload POST outlive the page.
      apiClient
        .post(`/fs/${id}/session`, { terminalId, scrollback }, { keepalive: true } as RequestInit)
        .catch(() => {});
    };

    const interval = window.setInterval(save, SNAPSHOT_INTERVAL_MS);
    window.addEventListener('beforeunload', save);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', save);
      save(); // final flush on unmount
    };
  }, [sessionKey, termRef]);
}
