// src/components/env-manager/EnvManager.tsx
import React from 'react';
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
    exportError 
  } = useEnvManager();

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-gray-200 p-6 font-sans">
      <form onSubmit={handleExport} className="max-w-[1400px] mx-auto flex gap-6 items-start">
        
        {/* Left Column: Construction Area */}
        <div className="flex-1 flex flex-col gap-6">
          <div className="mb-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-100">Environment Architect</h1>
            <p className="text-gray-400 text-sm">Configure packages and dependencies</p>
          </div>

          {/* If there's a global export error, show it here */}
          {exportError && (
            <div className="p-3 bg-red-900/20 border border-red-500 rounded text-red-400 text-sm">
              <strong>Export Failed:</strong> {exportError}
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
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-[#252526] p-6 rounded-lg border border-[#3c3f41] shadow-2xl flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-[#569cd6] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 font-jetbrains text-sm">Compiling Environment...</p>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};