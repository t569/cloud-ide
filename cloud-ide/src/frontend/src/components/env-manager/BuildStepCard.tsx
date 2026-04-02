import { useWatch, Control, UseFormRegister } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';

import { DynamicPackageIcon } from '../../utils/packageIcons';

interface BuildStepCardProps {
  index: number;
  control: Control<EnvironmentConfig>;
  register: UseFormRegister<EnvironmentConfig>;
  onRemove: () => void;
}

export const BuildStepCard = ({ index, control, register, onRemove }: BuildStepCardProps) => {
  // Watch the specific type of this index
  const stepType = useWatch({
    control,
    name: `buildSteps.${index}.type`
  });

  // 2. Watch the global baseImage so we can pass it to the icon for smart fallbacks
  const baseImage = useWatch({
    control,
    name: 'baseImage'
  });

  return (
    <div className="p-4 border rounded mb-4 bg-white shadow-sm flex flex-col gap-4">
      {/* Header: Icon, Type Selector, and Remove Button */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          
          {/* 3. REPLACED StepIcon with DynamicPackageIcon */}
          <div className="w-6 h-6 flex items-center justify-center">
            <DynamicPackageIcon 
              name={stepType}    // Pass the tool name (e.g., 'npm', 'pip') to try the CDN first
              type={stepType}    // Pass the type to trigger your 'shell' or 'system' fallbacks
              baseImage={baseImage} // Pass the base image for language-specific fallbacks
              size={24} 
            />
          </div>

          <select 
            {...register(`buildSteps.${index}.type`)} 
            className="p-1.5 border rounded bg-gray-50 font-medium cursor-pointer"
          >
            // TODO: make this dynamic from a constants file or something, but for now this is fine
            {['apt', 'npm', 'pip', 'cargo', 'go', 'ruby', 'maven', 'zig', 'shell'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <button 
          type="button" 
          onClick={onRemove} 
          className="text-red-500 hover:text-red-700 text-sm font-semibold"
        >
          Remove Step
        </button>
      </div>

      {/* Step Name */}
      <input 
        {...register(`buildSteps.${index}.name`)} 
        placeholder="Step Name (e.g., Install Global Python Tools)" 
        className="p-2 border rounded w-full" 
      />

      {/* Conditional Rendering Logic based on Step Type */}
      {stepType === 'shell' ? (
        <textarea 
          {...register(`buildSteps.${index}.command`)} 
          placeholder="Enter shell command (e.g. curl -L ... | bash)" 
          className="p-2 border rounded font-mono text-sm w-full h-24"
        />
      ) : (
        <div className="flex flex-col gap-3 border-t pt-3">
          <input 
            {...register(`buildSteps.${index}.packages` as const, {
                setValueAs: (v: string) => v ? v.split(',').map(s => s.trim()) : []
            })} 
            placeholder="Packages (comma separated, e.g. fastapi, uvicorn)" 
            className="p-2 border rounded w-full"
          />
          
          <div className="flex gap-6 items-center bg-gray-50 p-2 rounded">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input 
                type="checkbox" 
                {...register(`buildSteps.${index}.isGlobal`)} 
                className="w-4 h-4 rounded"
              />
              Global System Install
            </label>
            <input 
              {...register(`buildSteps.${index}.targetPath`)} 
              placeholder="Target Path (e.g. /workspace/api)" 
              className="p-1.5 border rounded text-sm flex-1"
            />
          </div>
        </div>
      )}
    </div>
  );
};