import React from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { exportEnvironmentConfig } from '../services/api/exportApi';

// Import our newly decoupled components
import { JsonPreviewWidget } from './widgets/JsonPreviewWidget';
import { BuildPipeline } from './BuildPipeline';
import { BaseImageIcon } from './icons/BaseImageIcon';

export const EnvManager = () => {
  const [isExporting, setIsExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);


  const { control, handleSubmit, watch, register, setValue } = useForm<EnvironmentConfig>({
    defaultValues: {
      id: '',
      name: '',
      baseImage: 'ubuntu:22.04',
      buildSteps: []
    }
  });

  const currentConfig = watch();
  const baseImage = watch('baseImage');

  // const onSubmit = (data: EnvironmentConfig) => {
  //   console.log("Final JSON:", JSON.stringify(data, null, 2));
  //   alert("Environment Configuration Generated!");
  // };


  // SuBMISSION HANDLER WITH API CALL
  const onSubmit: SubmitHandler<EnvironmentConfig> = async (data) => {
    setIsExporting(true);
    setExportError(null);


    try {
      // Send to the backend
      const response = await exportEnvironmentConfig(data);
      
      // Success! You could redirect the user or show a success toast here
      console.log('✅ Export Successful:', response);
      alert('Environment successfully exported and built!');

    } catch (error) {
      console.error('❌ Export Error:', error);
      setExportError((error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    // JetBrains Darcula-inspired background
    <div className="min-h-screen bg-[#1e1e1e] text-gray-200 p-6 font-sans">
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-[1400px] mx-auto flex gap-6 items-start">
        
        {/* Left Column: Form Builder (Scrollable independently) */}
        <div className="flex-1 flex flex-col gap-6">
          
          <div className="mb-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-100">Environment Architect</h1>
            <p className="text-gray-400 text-sm">Configure packages and dependencies</p>
          </div>

          {/* General Settings Card (Inline to keep orchestrator simple, or decouple further if needed) */}
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
              {/* Inputs styled like IDE text fields */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider font-sans">Environment ID</label>
                <input 
                  {...register('id')} 
                  placeholder="e.g. zkp-noir-env" 
                  className="w-full p-2 bg-[#1e1e1e] border border-[#3c3f41] rounded text-gray-200 text-sm focus:border-[#569cd6] outline-none transition" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider font-sans">Base Docker Image</label>
                <input 
                  {...register('baseImage')} 
                  placeholder="ubuntu:22.04" 
                  className="w-full p-2 bg-[#1e1e1e] border border-[#3c3f41] rounded text-gray-200 text-sm focus:border-[#569cd6] outline-none transition" 
                />
              </div>
            </div>
          </div>

          {/* The scrolling pipeline and bottom action buttons */}
          <BuildPipeline 
            control={control} 
            register={register} 
            setValue={setValue} 
          />

        </div>

        {/* Right Column: Sticky Interactive Preview */}
        <JsonPreviewWidget config={currentConfig} />

        {/* Optional Loading Overlay for UX */}
      {isExporting && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-[#252526] p-6 rounded-lg border border-vscode-border shadow-2xl flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-vscode-accent border-t-transparent rounded-full animate-spin"></div>
            <p className="text-vscode-textDim font-jetbrains text-sm">Compiling Environment...</p>
          </div>
        </div>
        )}
      </form>
    </div>
  );
};