// src/components/env-manager/hooks/useBuildStepForm.ts
import { useEffect, useCallback, useRef } from 'react';
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

  // 2. Wipe packages ONLY when the user actually switches language (npm -> pip).
  // Keyed off a ref of the previous type so it never fires on mount or on the
  // many re-renders the root watch() triggers — those were clearing packages the
  // user just added (and packages restored from a saved env). undefined prev =
  // first render (mount/load): remember the type, don't wipe.
  const prevType = useRef<InstallStepType | undefined>(undefined);
  useEffect(() => {
    const changed = prevType.current !== undefined && prevType.current !== stepType;
    prevType.current = stepType;
    if (changed && stepType !== 'shell') {
      setValue(`buildSteps.${index}.packages`, [], { shouldDirty: true });
    }
  }, [stepType, index, setValue]);

  // 3. Callbacks
  const handlePackagesChange = useCallback((newPackages: string[]) => {
    setValue(`buildSteps.${index}.packages`, newPackages, { shouldDirty: true });
  }, [index, setValue]);

  return { stepType, packageList, handlePackagesChange };
};