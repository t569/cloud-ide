// src/components/env-manager/EnvManager.tsx
import React, { useState } from 'react';
import { useEnvManager } from '../hooks/useEnvManager';
import { useEnvironments } from '../hooks/useEnvironments';
import { SavedEnvironment } from '../services/api/environmentApi';

// Decoupled sub-components
import { MyEnvironments } from './MyEnvironments';
import { GeneralSettings } from './GeneralSettings';
import { BuildPipeline } from './BuildPipeline';
import { JsonPreviewWidget } from './widgets/JsonPreviewWidget';

export const EnvManager = () => {
  const { environments, isLoading, error, refresh, remove } = useEnvironments();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const {
    register,
    control,
    setValue,
    handleExport,
    currentConfig,
    baseImage,
    isExporting,
    loadEnvironment,
    resetToNew,
  } = useEnvManager(refresh); // refresh the saved list after a successful save

  const handleOpen = (env: SavedEnvironment) => {
    if (!env.builderConfig) return;
    loadEnvironment(env.builderConfig);
    setSelectedId(env.id);
  };

  const handleCreateNew = () => {
    resetToNew();
    setSelectedId(null);
  };

  const handleDelete = (id: string) => {
    remove(id);
    if (selectedId === id) handleCreateNew();
  };

  return (
    <div className="min-h-screen bg-[#1e1e1e] text-gray-200 p-6 font-sans bg-[radial-gradient(ellipse_at_top,_rgba(53,116,212,0.06),_transparent_55%)]">
      <div className="max-w-[1600px] mx-auto flex gap-6 items-start">

        {/* Left: saved environments from the backend DB */}
        <MyEnvironments
          environments={environments}
          isLoading={isLoading}
          error={error}
          selectedId={selectedId}
          onOpen={handleOpen}
          onDelete={handleDelete}
          onCreateNew={handleCreateNew}
          onRefresh={refresh}
        />

        <form onSubmit={handleExport} className="flex-1 flex gap-6 items-start">
          {/* Middle: Construction Area */}
          <div className="flex-1 flex flex-col gap-6 animate-fade-up">
            <div className="mb-1">
              <h1 className="text-2xl font-bold tracking-tight text-gray-50">Environment Architect</h1>
              <p className="text-gray-500 text-sm mt-0.5">Configure packages and dependencies</p>
            </div>

            <GeneralSettings register={register} baseImage={baseImage} />

            <BuildPipeline control={control} register={register} setValue={setValue} />
          </div>

          {/* Right: Interactive Preview */}
          <JsonPreviewWidget config={currentConfig} />
        </form>

        {/* Global Loading Overlay */}
        {isExporting && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center animate-fade-in">
            <div className="bg-[#252526] p-6 rounded-xl border border-white/[0.08] shadow-2xl flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-[3px] border-[#3574d4] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-gray-400 font-jetbrains text-sm">Compiling Environment...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
