import { useEffect } from 'react';
import { useWatch, Control, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { EnvironmentConfig, InstallStepType } from '@cloud-ide/shared/types/env';

import { StepIcon } from './icons/StepIcon';
import { PackageIcon } from './icons/PackageIcon';

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

  const packages = useWatch({
    control,
    name: `buildSteps.${index}.packages`
  }) as string[] | undefined;

  const packageList = packages || [];

  // 3. EFFECT: Wipe packages when the stepType changes
  useEffect(() => {
    // We only wipe it if it's not a shell step (since shell doesn't use the packages array anyway)
    if (stepType !== 'shell') {
      setValue(`buildSteps.${index}.packages`, []);
    }
  }, [stepType, index, setValue]);


  return (
    // Changed to use your VS Code Sidebar color and a subtle border
    <div className="p-4 border border-vscode-border rounded mb-4 bg-vscode-sidebar text-white shadow-lg flex flex-col gap-4">
      
      {/* Header: Tool Icon, Type Selector, and Remove Button */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 flex items-center justify-center">
            <StepIcon type={stepType} size={24} />
          </div>

          <select 
            {...register(`buildSteps.${index}.type`)} 
            // Using IDE colors for the dropdown
            className="p-1.5 border border-vscode-border rounded bg-vscode-tab text-vscode-textDim font-medium cursor-pointer focus:border-vscode-accent outline-none"
          >
            {/* TODO: we need to route this dynamically from InstallStepType enum */}
            {['apt', 'npm', 'pip', 'cargo', 'go', 'ruby', 'maven', 'gradle', 'zig', 'shell'].map(t => (
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
        placeholder="Step Name (e.g., Install Global Python Tools)" 
        // Explicitly using the IDE background and text colors
        className="p-2 border border-vscode-border rounded w-full bg-vscode-bg text-white placeholder:text-vscode-textDim/50 focus:border-vscode-accent outline-none" 
      />

      {/* Conditional Rendering: Shell Command vs. Package Management */}
      {stepType === 'shell' ? (
        <textarea 
          {...register(`buildSteps.${index}.command`)} 
          placeholder="Enter shell command..." 
          className="p-2 border border-vscode-border rounded font-mono text-sm w-full h-24 bg-vscode-bg text-white placeholder:text-vscode-textDim/50 focus:border-vscode-accent outline-none"
        />
      ) : (
        <div className="flex flex-col gap-3 border-t border-vscode-border pt-3">
          <div className="flex flex-col gap-2">
            <input 
              key={stepType} // Reset input when type changes
              {...register(`buildSteps.${index}.packages` as const, {
                setValueAs: (v) => {
                  if (Array.isArray(v)) return v;
                  return v ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : [];
                }
              })} 
              defaultValue={packageList.join(', ')}
              placeholder="Packages (comma separated, e.g. fastapi, uvicorn)" 
              className="p-2 border border-vscode-border rounded w-full bg-vscode-bg text-white placeholder:text-vscode-textDim/50 focus:border-vscode-accent outline-none"
            />

            {/* Individual Package Badges - Styled like IDE Tabs */}
            {packageList.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {packageList.map((pkg, i) => (
                  <div 
                    key={`${pkg}-${i}`} 
                    className="flex items-center gap-2 bg-vscode-tab border border-vscode-border rounded-md px-2.5 py-1 text-sm text-vscode-textDim shadow-sm"
                  >
                    <PackageIcon name={pkg} type={stepType} size={14} />
                    <span className="font-mono">{pkg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer Config: Global Toggle and Target Path */}
          <div className="flex gap-6 items-center bg-vscode-bg/50 p-2 rounded mt-1 border border-vscode-border">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-vscode-textDim">
              <input 
                type="checkbox" 
                {...register(`buildSteps.${index}.isGlobal`)} 
                className="w-4 h-4 rounded border-vscode-border bg-vscode-bg text-vscode-accent focus:ring-0"
              />
              Global Install
            </label>
            <input 
              {...register(`buildSteps.${index}.targetPath`)} 
              placeholder="Target Path (e.g. /workspace/api)" 
              className="p-1 border-b border-vscode-border bg-transparent text-sm flex-1 text-vscode-textDim placeholder:text-vscode-textDim/30 outline-none focus:border-vscode-accent"
            />
          </div>
        </div>
      )}
    </div>
  );
};