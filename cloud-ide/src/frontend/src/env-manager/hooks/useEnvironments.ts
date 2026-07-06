import { useCallback, useEffect, useState } from 'react';
import { toast } from '@frontend/notifications';
import {
  SavedEnvironment,
  listEnvironments,
  deleteEnvironment,
} from '../services/api/environmentApi';

// Loads and manages the list of saved environments from the backend DB.
export const useEnvironments = () => {
  const [environments, setEnvironments] = useState<SavedEnvironment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setEnvironments(await listEnvironments());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteEnvironment(id);
      setEnvironments((prev) => prev.filter((e) => e.id !== id));
      toast.success(`Deleted environment "${id}"`, { title: 'Removed' });
    } catch (e) {
      // e.g. 409 when active sessions still use it — surface the backend reason
      toast.error((e as Error).message, { title: 'Delete failed' });
    }
  }, []);

  return { environments, isLoading, error, refresh, remove };
};
