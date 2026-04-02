import { useForm, useFieldArray } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { BuildStepCard } from './BuildStepCard';
import { BaseImageIcon } from './icons/BaseImageIcon';

export const EnvManager = () => {
  const { control, handleSubmit, watch, register, setValue } = useForm<EnvironmentConfig>({
    defaultValues: {
      id: '',
      name: '',
      baseImage: 'ubuntu:22.04',
      buildSteps: []
    }
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'buildSteps'
  });

  // Watch values for the live preview and the icon
  const currentConfig = watch();
  const baseImage = watch('baseImage');


  const onSubmit = (data: EnvironmentConfig) => {
    // You can send 'data' to your backend or download it as a file here
    console.log("Final JSON:", JSON.stringify(data, null, 2));
    alert("Environment Configuration Generated!");
    alert("JSON logged to console!");
  };

  return (
    <div className="min-h-screen bg-vscode-bg text-white p-6 font-sans">
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-7xl mx-auto flex gap-6 items-start">
        
        {/* Left Column: Form Builder */}
        <div className="flex-1 space-y-6">
        
          {/* Header Section */}
          <div className="flex justify-between items-end mb-2">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">Environment Designer</h1>
              <p className="text-vscode-textDim text-sm">Configure your cloud development container</p>
            </div>
            <button 
              type="submit" 
              className="px-6 py-2.5 bg-vscode-accent hover:brightness-110 text-white font-bold rounded shadow-lg transition-all active:scale-95"
            >
              Export Config
            </button>
          </div>
          
          {/* Basic Info Configuration */}
          <div className="p-6 bg-vscode-sidebar border border-vscode-border rounded-lg shadow-sm font-mono">
            <div className="flex items-center gap-3 mb-6 border-b border-vscode-border pb-4">
              <div className="p-2 bg-vscode-bg rounded">
                <BaseImageIcon imageName={baseImage} size={32} />
              </div>
              <div>
                <h2 className="text-lg font-semibold">General Settings</h2>
                <p className="text-xs text-vscode-textDim">Define your image identity</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-vscode-textDim uppercase tracking-wider">Environment ID</label>
                <input 
                  {...register('id')} 
                  placeholder="e.g. node-stack-v1" 
                  className="w-full p-2 bg-vscode-bg border border-vscode-border rounded text-white font-mono text-sm focus:border-vscode-accent outline-none" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-vscode-textDim uppercase tracking-wider">Display Name</label>
                <input 
                  {...register('name')} 
                  placeholder="e.g. Node.js Development" 
                  className="w-full p-2 bg-vscode-bg border border-vscode-border rounded text-white text-sm focus:border-vscode-accent outline-none" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-vscode-textDim uppercase tracking-wider">Base Docker Image</label>
                <input 
                  {...register('baseImage')} 
                  placeholder="ubuntu:22.04" 
                  className="w-full p-2 bg-vscode-bg border border-vscode-border rounded text-white font-mono text-sm focus:border-vscode-accent outline-none" 
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-vscode-textDim uppercase tracking-wider">Target Platform</label>
                <select 
                  {...register('platform')} 
                  className="w-full p-2 bg-vscode-bg border border-vscode-border rounded text-white text-sm focus:border-vscode-accent outline-none appearance-none"
                >
                  <option value="">Auto-detect</option>
                  <option value="linux/amd64">linux/amd64 (x86)</option>
                  <option value="linux/arm64">linux/arm64 (Apple Silicon)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Dynamic Build Steps Section */}
          <div className="p-6 bg-vscode-sidebar border border-vscode-border rounded-lg shadow-sm font-mono">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-semibold">Build Pipeline</h2>
              <button 
                type="button" 
                onClick={() => append({ name: '', type: 'apt', packages: [], isGlobal: true })}
                className="text-[10px] px-3 py-1.5 bg-vscode-tab hover:bg-vscode-bg border border-vscode-border rounded text-vscode-accent font-bold uppercase transition-colors"
              >
                + Add Step
              </button>
            </div>

            <div className="space-y-4">
              {fields.length === 0 && (
                <div className="py-12 border-2 border-dashed border-vscode-border rounded-lg text-center">
                  <p className="text-vscode-textDim text-sm">No build steps defined. Start by adding one above.</p>
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
          </div>
        </div>


        {/* Right Column: Live Code Preview */}
        <div className="w-[450px] sticky top-6">
          <div className="bg-vscode-sidebar border border-vscode-border rounded-lg shadow-2xl overflow-hidden flex flex-col h-[calc(100vh-3rem)]">
            <div className="px-4 py-3 bg-vscode-tab border-b border-vscode-border flex items-center justify-between">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
              </div>
              <span className="text-[10px] font-mono text-vscode-textDim uppercase tracking-tighter">schema.json</span>
            </div>
            
            <div className="flex-1 p-4 overflow-auto bg-vscode-bg scrollbar-thin scrollbar-thumb-vscode-border">
              <pre className="text-[11px] font-mono leading-relaxed text-vscode-accent">
                {JSON.stringify(currentConfig, null, 2)}
              </pre>
            </div>
            
            <div className="p-3 bg-vscode-tab border-t border-vscode-border text-[10px] font-mono text-vscode-textDim flex justify-between">
              <span>UTF-8</span>
              <span>JSON</span>
            </div>
          </div>
        </div>

      </form>
    </div>
  );
};