// src/components/env-manager/components/BuildPipeline.tsx
import React from 'react';
import { Control, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { VscAdd, VscLayers, VscRocket, VscPackage } from 'react-icons/vsc';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { BuildStepCard } from './BuildStepCard';
import { useBuildPipeline } from '../hooks/useBuildPipeline';

interface BuildPipelineProps {
  control: Control<EnvironmentConfig>;
  register: UseFormRegister<EnvironmentConfig>;
  setValue: UseFormSetValue<EnvironmentConfig>;
}

export const BuildPipeline = ({ control, register, setValue }: BuildPipelineProps) => {
  // 1. Attach the pipeline brains
  const { steps, addDefaultStep, removeStep } = useBuildPipeline(control);

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-xl bg-gradient-to-b from-[#2c2c2c] to-[#272727] border border-white/[0.06] shadow-lg shadow-black/20 font-jetbrains overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-white/[0.06] bg-white/[0.02] flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <VscLayers className="text-[#3574d4]" size={18} />
          <h2 className="text-lg font-semibold text-gray-100 font-sans">Build Pipeline</h2>
        </div>
        {steps.length > 0 && (
          <span className="text-[11px] font-sans font-medium text-gray-400 bg-white/[0.05] border border-white/[0.06] rounded-full px-2.5 py-0.5">
            {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          </span>
        )}
      </div>

      {/* Scrollable List Area */}
      <div className="p-4 overflow-y-auto space-y-4 max-h-[500px] scrollbar-thin">
        {steps.length === 0 ? (
          <div className="py-14 border-2 border-dashed border-white/[0.08] rounded-xl text-center flex flex-col items-center gap-2">
            <VscPackage className="text-gray-600" size={28} />
            <p className="text-gray-400 text-sm font-sans font-medium">No packages or tools configured</p>
            <p className="text-gray-600 text-xs font-sans">Add a dependency step to start building your environment</p>
          </div>
        ) : (
          steps.map((field, index) => (
            <BuildStepCard
              key={field.id}
              index={index}
              control={control}
              register={register}
              setValue={setValue}
              onRemove={() => removeStep(index)}
            />
          ))
        )}
      </div>

      {/* Action Footer */}
      <div className="px-5 py-4 border-t border-white/[0.06] bg-white/[0.02] flex justify-between items-center">
        <button
          type="button"
          onClick={addDefaultStep}
          className="flex items-center gap-2 px-4 py-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-lg text-gray-200 text-sm font-sans font-medium transition-all active:scale-[0.98]"
        >
          <VscAdd size={14} />
          Add Dependency Step
        </button>

        <button
          type="submit"
          className="flex items-center gap-2 px-5 py-2 bg-gradient-to-b from-[#3b82f6] to-[#2563eb] hover:from-[#2f74e8] hover:to-[#1d4ed8] text-white text-sm font-sans font-semibold rounded-lg shadow-lg shadow-blue-600/25 transition-all active:scale-[0.98]"
        >
          <VscRocket size={15} />
          Export Environment
        </button>
      </div>
    </div>
  );
};
