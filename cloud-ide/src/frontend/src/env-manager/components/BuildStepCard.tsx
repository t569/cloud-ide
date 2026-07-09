// src/components/env-manager/components/BuildStepCard.tsx
import React from 'react';
import { Control, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { VscChevronDown, VscTrash } from 'react-icons/vsc';
import { EnvironmentConfig, INSTALL_STEPS } from '@cloud-ide/shared/types/env';

import { EnvIcon } from '../registry/EnvIcon';
import { DependencyManager } from './DependencyManager';
import { useBuildStepForm } from '../hooks/useBuildStepForm';

interface BuildStepCardProps {
  index: number;
  control: Control<EnvironmentConfig>;
  register: UseFormRegister<EnvironmentConfig>;
  setValue: UseFormSetValue<EnvironmentConfig>;
  onRemove: () => void;
}

export const BuildStepCard = ({ index, control, register, setValue, onRemove }: BuildStepCardProps) => {
  // 1. Attach the form brains
  const { stepType, packageList, handlePackagesChange } = useBuildStepForm(index, control, setValue, register);

  // 2. Pure UI Return
  return (
    <div className="group/card p-4 rounded-lg border border-white/[0.07] bg-[#1f1f1f] text-white shadow-md shadow-black/20 flex flex-col gap-4 transition-colors hover:border-white/[0.12] animate-fade-up">

      {/* Header: step index, tool icon, type selector, remove */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 flex items-center justify-center rounded-md bg-white/[0.06] text-[10px] font-bold text-gray-400 font-jetbrains">
            {index + 1}
          </span>
          <div className="w-6 h-6 flex items-center justify-center">
            <EnvIcon type={stepType} size={24} />
          </div>

          <div className="relative">
            <select
              {...register(`buildSteps.${index}.type`)}
              className="appearance-none pl-3 pr-8 py-1.5 border border-white/[0.08] rounded-md bg-[#2a2a2a] text-gray-200 text-sm font-medium cursor-pointer transition-colors hover:border-white/[0.15] focus:border-[#3574d4] outline-none"
            >
              {INSTALL_STEPS.map((t) => (
                <option key={t} value={t} className="bg-[#2a2a2a] text-white">
                  {t}
                </option>
              ))}
            </select>
            <VscChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none"
              size={14}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="flex items-center gap-1.5 text-gray-500 hover:text-red-400 text-sm font-medium transition-colors opacity-60 group-hover/card:opacity-100"
        >
          <VscTrash size={14} />
          Remove
        </button>
      </div>

      {/* Step Name Input */}
      <input
        {...register(`buildSteps.${index}.name`)}
        placeholder="Step Name (e.g., Install Global Dependencies)"
        className="p-2.5 border border-white/[0.07] rounded-lg w-full bg-[#161616] text-white placeholder:text-gray-600 transition-all hover:border-white/[0.12] focus:border-[#3574d4] focus:ring-2 focus:ring-[#3574d4]/25 outline-none font-jetbrains text-sm"
      />

      {/* Conditional Rendering: Shell Command vs. Dependency Manager */}
      {stepType === 'shell' ? (
        <textarea
          {...register(`buildSteps.${index}.command`)}
          placeholder="Enter shell command..."
          className="p-2.5 border border-white/[0.07] rounded-lg font-jetbrains text-sm w-full h-24 bg-[#161616] text-white placeholder:text-gray-600 transition-all hover:border-white/[0.12] focus:border-[#3574d4] focus:ring-2 focus:ring-[#3574d4]/25 outline-none resize-y"
        />
      ) : (
        <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4">

          <DependencyManager
            stepType={stepType}
            packages={packageList}
            onChange={handlePackagesChange}
          />

          {/* Footer Config: Global Toggle and Target Path */}
          <div className="flex gap-5 items-center bg-black/20 p-2.5 rounded-lg border border-white/[0.05] mt-1">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-gray-400 select-none whitespace-nowrap">
              <input
                type="checkbox"
                {...register(`buildSteps.${index}.isGlobal`)}
                className="w-4 h-4 rounded border-white/10 bg-[#161616] accent-[#3574d4] focus:ring-0"
              />
              Global Install
            </label>
            <input
              {...register(`buildSteps.${index}.targetPath`)}
              placeholder="Target Path (e.g. /workspace/api)"
              className="p-1 border-b border-white/[0.08] bg-transparent text-sm flex-1 text-gray-300 placeholder:text-gray-600 outline-none focus:border-[#3574d4] transition-colors font-jetbrains"
            />
          </div>
        </div>
      )}
    </div>
  );
};
