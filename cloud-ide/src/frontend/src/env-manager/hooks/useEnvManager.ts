// src/components/env-manager/hooks/useEnvManager.ts
import { useState } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { exportEnvironmentConfig } from '../services/api/exportApi';

export const useEnvManager = () => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const form = useForm<EnvironmentConfig>({
    defaultValues: {
      id: '',
      name: '',
      baseImage: 'ubuntu:22.04',
      buildSteps: []
    }
  });

  const { handleSubmit, watch } = form;

  // Watch the entire config for the JsonPreviewWidget
  const currentConfig = watch();
  // Watch specifically for the icon display
  const baseImage = watch('baseImage');

  const onSubmit: SubmitHandler<EnvironmentConfig> = async (data) => {
    setIsExporting(true);
    setExportError(null);

    try {
      const response = await exportEnvironmentConfig(data);
      console.log('✅ Export Successful:', response);
      alert('Environment successfully exported and built!');
    } catch (error) {
      console.error('❌ Export Error:', error);
      setExportError((error as Error).message);
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
    handleExport: handleSubmit(onSubmit)
  };
};