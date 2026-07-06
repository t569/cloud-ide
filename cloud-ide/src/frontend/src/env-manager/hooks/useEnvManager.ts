// src/components/env-manager/hooks/useEnvManager.ts
import { useState } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { toast } from '@frontend/notifications';
import { exportEnvironmentConfig } from '../services/api/exportApi';

const BLANK_CONFIG: EnvironmentConfig = {
  id: '',
  name: '',
  baseImage: 'ubuntu:22.04',
  buildSteps: [],
};

export const useEnvManager = (onSaved?: () => void) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const form = useForm<EnvironmentConfig>({ defaultValues: BLANK_CONFIG });
  const { handleSubmit, watch, reset } = form;

  // Watch the entire config for the JsonPreviewWidget
  const currentConfig = watch();
  // Watch specifically for the icon display
  const baseImage = watch('baseImage');

  const onSubmit: SubmitHandler<EnvironmentConfig> = async (data) => {
    setIsExporting(true);
    setExportError(null);

    try {
      await exportEnvironmentConfig(data);
      toast.success(`Environment "${data.name || data.id || 'untitled'}" saved`, { title: 'Saved' });
      onSaved?.(); // let the list refresh so the new/updated env shows up
    } catch (error) {
      const message = (error as Error).message;
      setExportError(message);
      toast.error(message, { title: 'Save failed' });
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
    handleExport: handleSubmit(onSubmit),
    // Load a saved environment's config into the architect form
    loadEnvironment: (config: EnvironmentConfig) => reset(config),
    // Clear the form back to a fresh blank environment
    resetToNew: () => reset(BLANK_CONFIG),
  };
};
