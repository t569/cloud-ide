// src/components/env-manager/BuildStepCard.tsx

import { useEffect } from 'react';
import { useWatch, Control, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { EnvironmentConfig, InstallStepType } from '@cloud-ide/shared/types/env';

import { StepIcon } from './icons/StepIcon';
import { DependencyManager } from './DependencyManager'; // Import the new manager

interface BuildStepCardProps {
  index: number;
  control: Control<EnvironmentConfig>;
  register: UseFormRegister<EnvironmentConfig>;
  setValue: UseFormSetValue<EnvironmentConfig>;
  onRemove: () => void;
}

export const BuildStepCard = ({ index, control, register, setValue, onRemove }: BuildStepCardProps) => {
  const stepType = useWatch({
    control,
    name: `buildSteps.${index}.type`
  }) as InstallStepType;

  // Watch the packages array directly
  const packages = useWatch({
    control,
    name: `buildSteps.${index}.packages`
  }) as string[] | undefined;

  const packageList = packages || [];

  // Wipe packages when the stepType changes so npm packages don't end up in pip
  useEffect(() => {
    if (stepType !== 'shell') {
      setValue(`buildSteps.${index}.packages`, []);
    }
  }, [stepType, index, setValue]);

  // Wrapper function to pass to DependencyManager
  const handlePackagesChange = (newPackages: string[]) => {
    setValue(`buildSteps.${index}.packages`, newPackages, { shouldDirty: true });
  };

  return (
    <div className="p-4 border border-vscode-border rounded mb-4 bg-vscode-sidebar text-white shadow-lg flex flex-col gap-4">
      
      {/* Header: Tool Icon, Type Selector, and Remove Button */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 flex items-center justify-center">
            <StepIcon type={stepType} size={24} />
          </div>

          <select 
            {...register(`buildSteps.${index}.type`)} 
            className="p-1.5 border border-vscode-border rounded bg-vscode-tab text-vscode-textDim font-medium cursor-pointer focus:border-vscode-accent outline-none"
          >
            {/* TODO: we need to make this more dynamic as we add more types, maybe with a config file or something */}
            {['apt', 'npm', 'pip', 'cargo', 'go', 'gradle', 'ruby', 'maven', 'zig', 'shell'].map(t => (
              <option key={t} value={t} className="bg-vscode-tab text-white">{t}</option>
            ))}
          </select>
        </div>
        
        <button 
          type="button" 
          onClick={onRemove} 
          className="text-red-400 hover:text-red-500 text-sm font-semibold transition-colors"
        >
          Remove Step
        </button>
      </div>

      {/* Step Name Input */}
      <input 
        {...register(`buildSteps.${index}.name`)} 
        placeholder="Step Name (e.g., Install Global Dependencies)" 
        className="p-2 border border-vscode-border rounded w-full bg-vscode-bg text-white placeholder:text-vscode-textDim/50 focus:border-vscode-accent outline-none font-jetbrains text-sm" 
      />

      {/* Conditional Rendering: Shell Command vs. The New Dependency Manager */}
      {stepType === 'shell' ? (
        <textarea 
          {...register(`buildSteps.${index}.command`)} 
          placeholder="Enter shell command..." 
          className="p-2 border border-vscode-border rounded font-jetbrains text-sm w-full h-24 bg-vscode-bg text-white placeholder:text-vscode-textDim/50 focus:border-vscode-accent outline-none"
        />
      ) : (
        <div className="flex flex-col gap-3 border-t border-vscode-border pt-3">
          
          {/* THE NEW INLINE MANAGER */}
          <DependencyManager 
            stepType={stepType}
            packages={packageList}
            onChange={handlePackagesChange}
          />

          {/* Footer Config: Global Toggle and Target Path */}
          <div className="flex gap-6 items-center bg-vscode-bg/50 p-2 rounded border border-vscode-border mt-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-vscode-textDim">
              <input 
                type="checkbox" 
                {...register(`buildSteps.${index}.isGlobal`)} 
                className="w-4 h-4 rounded border-vscode-border bg-vscode-bg focus:ring-0"
              />
              Global Install
            </label>
            <input 
              {...register(`buildSteps.${index}.targetPath`)} 
              placeholder="Target Path (e.g. /workspace/api)" 
              className="p-1 border-b border-vscode-border bg-transparent text-sm flex-1 text-vscode-textDim placeholder:text-vscode-textDim/30 outline-none focus:border-vscode-accent font-jetbrains"
            />
          </div>
        </div>
      )}
    </div>
  );
};