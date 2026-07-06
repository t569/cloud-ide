import { useEffect, useState } from 'react';
import { BuildState, listBuildStatuses } from '../services/api/environmentApi';

// Polls the bulk status endpoint and returns a { envId -> BuildState } map so
// cards can show live build status. ponytail: simple interval poll — fine for a
// single-node internal tool; swap for SSE/WebSocket if fan-out ever matters.
export const useBuildStatuses = (pollMs = 3500): Record<string, BuildState> => {
  const [statuses, setStatuses] = useState<Record<string, BuildState>>({});

  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const list = await listBuildStatuses();
        if (!alive) return;
        const map: Record<string, BuildState> = {};
        for (const s of list) map[s.envId] = s;
        setStatuses(map);
      } catch {
        /* transient network/backend-down — keep last known, try again next tick */
      }
    };

    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return statuses;
};
