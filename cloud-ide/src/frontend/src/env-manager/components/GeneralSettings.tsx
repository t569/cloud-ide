// src/components/env-manager/components/GeneralSettings.tsx
import React from 'react';
import { UseFormRegister } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { BaseImageIcon } from './icons/BaseImageIcon';

interface GeneralSettingsProps {
  register: UseFormRegister<EnvironmentConfig>;
  baseImage: string;
}

const inputCls =
  'w-full rounded-lg bg-[#1a1a1a] border border-white/[0.07] px-3 py-2.5 text-sm text-gray-100 outline-none transition-all placeholder:text-gray-600 hover:border-white/[0.12] focus:border-[#3574d4] focus:ring-2 focus:ring-[#3574d4]/25';

export const GeneralSettings = ({ register, baseImage }: GeneralSettingsProps) => {
  return (
    <div className="p-6 rounded-xl bg-gradient-to-b from-[#2c2c2c] to-[#272727] border border-white/[0.06] shadow-lg shadow-black/20">
      <div className="flex items-center gap-4 mb-6 border-b border-white/[0.06] pb-5">
        <div className="p-2.5 bg-[#1a1a1a] rounded-lg ring-1 ring-white/[0.06] shadow-inner">
          <BaseImageIcon imageName={baseImage} size={36} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Base Image Setup</h2>
          <p className="text-xs text-gray-500 mt-0.5">The foundation your container is built on</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-5 font-jetbrains">
        <div className="space-y-1.5 col-span-2">
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider font-sans">
            Display Name
          </label>
          <input {...register('name')} placeholder="e.g. ZKP-Noir Dev" className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider font-sans">
            Environment ID
          </label>
          <input {...register('id')} placeholder="e.g. zkp-noir-env" className={inputCls} />
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider font-sans">
            Base Docker Image
          </label>
          <input {...register('baseImage')} placeholder="ubuntu:22.04" className={inputCls} />
        </div>
      </div>
    </div>
  );
};
