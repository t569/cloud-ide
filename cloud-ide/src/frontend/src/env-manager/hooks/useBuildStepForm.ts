// src/components/env-manager/hooks/useBuildStepForm.ts
import { useEffect, useCallback } from 'react';
import { useWatch, Control, UseFormSetValue } from 'react-hook-form';
import { EnvironmentConfig, InstallStepType } from '@cloud-ide/shared/types/env';

export const useBuildStepForm = (
  index: number,
  control: Control<EnvironmentConfig>,
  setValue: UseFormSetValue<EnvironmentConfig>
) => {
  // 1. Watch the form state
  const stepType = useWatch({
    control,
    name: `buildSteps.${index}.type`
  }) as InstallStepType;

  const packages = useWatch({
    control,
    name: `buildSteps.${index}.packages`
  }) as string[] | undefined;

  const packageList = packages || [];

  // 2. Form Side-Effects: Wipe packages when changing languages
  useEffect(() => {
    // If we switch from 'npm' to 'pip', clear the node modules out of the array
    if (stepType !== 'shell') {
      setValue(`buildSteps.${index}.packages`, [], { shouldDirty: true });
    }
  }, [stepType, index, setValue]);

  // 3. Callbacks
  const handlePackagesChange = useCallback((newPackages: string[]) => {
    setValue(`buildSteps.${index}.packages`, newPackages, { shouldDirty: true });
  }, [index, setValue]);

  return { stepType, packageList, handlePackagesChange };
};