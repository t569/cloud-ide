// src/components/env-manager/components/GeneralSettings.tsx
import React from 'react';
import { UseFormRegister } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { BaseImageIcon } from './icons/BaseImageIcon';

interface GeneralSettingsProps {
  register: UseFormRegister<EnvironmentConfig>;
  baseImage: string;
}

export const GeneralSettings = ({ register, baseImage }: GeneralSettingsProps) => {
  return (
    <div className="p-6 bg-[#2b2b2b] border border-[#3c3f41] rounded-lg shadow-sm">
      <div className="flex items-center gap-4 mb-6 border-b border-[#3c3f41] pb-4">
        <div className="p-2 bg-[#1e1e1e] rounded shadow-inner">
          <BaseImageIcon imageName={baseImage} size={36} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Base Image Setup</h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 font-jetbrains">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider font-sans">
            Environment ID
          </label>
          <input 
            {...register('id')} 
            placeholder="e.g. zkp-noir-env" 
            className="w-full p-2 bg-[#1e1e1e] border border-[#3c3f41] rounded text-gray-200 text-sm focus:border-[#569cd6] outline-none transition" 
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-wider font-sans">
            Base Docker Image
          </label>
          <input 
            {...register('baseImage')} 
            placeholder="ubuntu:22.04" 
            className="w-full p-2 bg-[#1e1e1e] border border-[#3c3f41] rounded text-gray-200 text-sm focus:border-[#569cd6] outline-none transition" 
          />
        </div>
      </div>
    </div>
  );
};