import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@frontend/config/env';
import { BuildState } from '../services/api/environmentApi';

// Subscribes to the backend SSE stream and returns a live { envId -> BuildState }
// map. EventSource auto-reconnects on drop; the server replays a 'snapshot' on
// every (re)connect, so state self-heals without extra logic.
export const useBuildStatuses = (): Record<string, BuildState> => {
  const [statuses, setStatuses] = useState<Record<string, BuildState>>({});

  useEffect(() => {
    const es = new EventSource(`${API_BASE_URL}/environment/events`, { withCredentials: true });

    es.addEventListener('snapshot', (e) => {
      const list = JSON.parse((e as MessageEvent).data) as BuildState[];
      const map: Record<string, BuildState> = {};
      for (const s of list) map[s.envId] = s;
      setStatuses(map);
    });

    es.addEventListener('change', (e) => {
      const s = JSON.parse((e as MessageEvent).data) as BuildState;
      setStatuses((prev) => ({ ...prev, [s.envId]: s }));
    });

    // onerror: EventSource reconnects itself; nothing to do here.
    return () => es.close();
  }, []);

  return statuses;
};
