// src/frontend/src/components/env-manager/BuildPipeline.tsx

// This component manages the build pipeline section of the environment configuration. It allows users to add, edit, and remove build steps, which can be of various types (npm, pip, apt, etc.). Each step is represented by a BuildStepCard, and the entire pipeline can be exported as part of the environment configuration.

import { Control, UseFormRegister, UseFormSetValue, useFieldArray } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { BuildStepCard } from './BuildStepCard';

interface BuildPipelineProps {
  control: Control<EnvironmentConfig>;
  register: UseFormRegister<EnvironmentConfig>;
  setValue: UseFormSetValue<EnvironmentConfig>;
}

export const BuildPipeline = ({ control, register, setValue }: BuildPipelineProps) => {
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'buildSteps'
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#2b2b2b] border border-[#3c3f41] rounded-lg shadow-sm font-jetbrains">
      <div className="p-4 border-b border-[#3c3f41] bg-[#323232] rounded-t-lg">
        <h2 className="text-lg font-semibold text-gray-200 font-sans">Build Pipeline</h2>
      </div>

      {/* Scrollable List Area */}
      <div className="p-4 overflow-y-auto space-y-4 max-h-[500px] scrollbar-thin scrollbar-thumb-[#4b4d4f]">
        {fields.length === 0 && (
          <div className="py-12 border-2 border-dashed border-[#4b4d4f] rounded-lg text-center">
            <p className="text-gray-400 text-sm font-sans">No packages or tools configured.</p>
          </div>
        )}
        {fields.map((field, index) => (
          <BuildStepCard 
            key={field.id} 
            index={index} 
            control={control}
            register={register}
            setValue={setValue}
            onRemove={() => remove(index)} 
          />
        ))}
      </div>

      {/* JetBrains/Anaconda Style Action Footer */}
      <div className="p-4 border-t border-[#3c3f41] bg-[#323232] rounded-b-lg flex justify-between items-center">
        <button 
          type="button" 
          onClick={() => append({ name: '', type: 'apt', packages: [], isGlobal: true })}
          className="px-4 py-2 bg-[#3c3f41] hover:bg-[#4b4d4f] border border-[#555] rounded text-gray-200 text-sm font-sans font-medium transition-colors"
        >
          + Add Dependency Step
        </button>
        
        <button 
          type="submit" 
          className="px-6 py-2 bg-[#3574d4] hover:bg-[#2b5ba8] text-white text-sm font-sans font-bold rounded shadow transition-all active:scale-95"
        >
          Export Environment
        </button>
      </div>
    </div>
  );
};