// src/components/env-manager/EnvManager.tsx
import React from 'react';
import { VscWarning } from 'react-icons/vsc';
import { useEnvManager } from '../hooks/useEnvManager';

// Decoupled sub-components
import { GeneralSettings } from './GeneralSettings';
import { BuildPipeline } from './BuildPipeline';
import { JsonPreviewWidget } from './widgets/JsonPreviewWidget';

export const EnvManager = () => {
  const {
    register,
    control,
    setValue,
    handleExport,
    currentConfig,
    baseImage,
    isExporting,
    exportError,
  } = useEnvManager();

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-gray-200 p-6 font-sans bg-[radial-gradient(ellipse_at_top,_rgba(53,116,212,0.06),_transparent_55%)]">
      <form onSubmit={handleExport} className="max-w-[1400px] mx-auto flex gap-6 items-start">

        {/* Left Column: Construction Area */}
        <div className="flex-1 flex flex-col gap-6 animate-fade-up">
          <div className="mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-gray-50">Environment Architect</h1>
            <p className="text-gray-500 text-sm mt-0.5">Configure packages and dependencies</p>
          </div>

          {/* If there's a global export error, show it here */}
          {exportError && (
            <div className="flex items-start gap-2.5 p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-red-300 text-sm animate-fade-up">
              <VscWarning className="mt-0.5 flex-shrink-0 text-red-400" size={16} />
              <span><strong className="text-red-200">Export Failed:</strong> {exportError}</span>
            </div>
          )}

          <GeneralSettings register={register} baseImage={baseImage} />

          <BuildPipeline
            control={control}
            register={register}
            setValue={setValue}
          />
        </div>

        {/* Right Column: Interactive Preview */}
        <JsonPreviewWidget config={currentConfig} />

        {/* Global Loading Overlay */}
        {isExporting && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in">
            <div className="bg-[#252526] p-6 rounded-xl border border-white/[0.08] shadow-2xl flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-[3px] border-[#3574d4] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 font-jetbrains text-sm">Compiling Environment...</p>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};
