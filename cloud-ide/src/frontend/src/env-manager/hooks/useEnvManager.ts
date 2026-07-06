// src/components/env-manager/hooks/useEnvManager.ts
import { useState } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { toast } from '@frontend/notifications';
import {
  SavedEnvironment,
  createEnvironment,
  updateEnvironment,
} from '../services/api/environmentApi';

const BLANK_CONFIG: EnvironmentConfig = {
  id: '',
  name: '',
  baseImage: 'ubuntu:22.04',
  buildSteps: [],
};

export const useEnvManager = (onSaved?: () => void) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // The id of the environment currently open in the Architect (null = new/unsaved).
  const [currentEnvId, setCurrentEnvId] = useState<string | null>(null);

  const form = useForm<EnvironmentConfig>({ defaultValues: BLANK_CONFIG });
  const { handleSubmit, watch, reset } = form;

  const currentConfig = watch();
  const baseImage = watch('baseImage');

  const onSubmit: SubmitHandler<EnvironmentConfig> = async (data) => {
    setIsExporting(true);
    setExportError(null);

    const isUpdate = currentEnvId !== null;
    try {
      const { environment } = isUpdate
        ? await updateEnvironment(currentEnvId, data)
        : await createEnvironment(data);

      // Adopt the server's canonical id/name (created id, auto-generated name…).
      setCurrentEnvId(environment.id);
      if (environment.builderConfig) reset(environment.builderConfig);

      const label = environment.builderConfig?.name || environment.id;
      toast.success(`Environment "${label}" ${isUpdate ? 'updated' : 'created'}`, {
        title: isUpdate ? 'Updated' : 'Created',
      });
      onSaved?.();
    } catch (error) {
      const message = (error as Error).message;
      setExportError(message);
      toast.error(message, { title: isUpdate ? 'Update failed' : 'Create failed' });
    } finally {
      setIsExporting(false);
    }
  };

  return {
    ...form,
    currentConfig,
    baseImage,
    isExporting,
    exportError,
    currentEnvId,
    handleExport: handleSubmit(onSubmit),
    // Load a saved environment into the architect (adopts its identity for updates).
    loadEnvironment: (env: SavedEnvironment) => {
      if (!env.builderConfig) return;
      reset(env.builderConfig);
      setCurrentEnvId(env.id);
    },
    // Clear back to a fresh, unsaved environment.
    resetToNew: () => {
      reset(BLANK_CONFIG);
      setCurrentEnvId(null);
    },
  };
};
