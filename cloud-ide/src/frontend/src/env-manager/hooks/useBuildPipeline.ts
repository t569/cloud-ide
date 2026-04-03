// src/components/env-manager/hooks/useBuildPipeline.ts
import { useFieldArray, Control } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';

export const useBuildPipeline = (control: Control<EnvironmentConfig>) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'buildSteps'
  });

  const addDefaultStep = () => {
    // Centralize the default state for a new step here
    append({ 
      name: '', 
      type: 'apt', 
      packages: [], 
      isGlobal: true,
      targetPath: '' 
    });
  };

  const removeStep = (index: number) => {
    remove(index);
  };

  return { 
    steps: fields, 
    addDefaultStep, 
    removeStep 
  };
};