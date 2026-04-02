import { useForm, useFieldArray } from 'react-hook-form';
import { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { BuildStepCard } from './BuildStepCard';

export const EnvManager = () => {
  const { control, handleSubmit, watch, register } = useForm<EnvironmentConfig>({
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

  const onSubmit = (data: EnvironmentConfig) => {
    // You can send 'data' to your backend or download it as a file here
    console.log("Final JSON:", JSON.stringify(data, null, 2));
    alert("JSON logged to console!");
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <form onSubmit={handleSubmit(onSubmit)} className="max-w-6xl mx-auto flex gap-8">
        
        {/* Left Column: Form Builder */}
        <div className="flex-1 space-y-8">
          
          {/* Basic Info Configuration */}
          <div className="p-6 bg-white border rounded shadow-sm">
            <h2 className="text-xl font-bold mb-4">Environment Config</h2>
            <div className="grid grid-cols-2 gap-4">
              <input {...register('id')} placeholder="Environment ID (e.g. zkp-noir-env)" className="p-2 border rounded" />
              <input {...register('name')} placeholder="Display Name" className="p-2 border rounded" />
              <input {...register('baseImage')} placeholder="Base Image (e.g. ubuntu:22.04)" className="p-2 border rounded" />
              <select {...register('platform')} className="p-2 border rounded">
                <option value="">Select Platform (Optional)</option>
                <option value="linux/amd64">linux/amd64</option>
                <option value="linux/arm64">linux/arm64</option>
              </select>
            </div>
          </div>

          {/* Dynamic Build Steps */}
          <div className="p-6 bg-gray-50 border rounded shadow-sm">
            <h2 className="text-xl font-bold mb-4">Build Steps</h2>
            {fields.map((field, index) => (
              <BuildStepCard 
                key={field.id} 
                index={index} 
                control={control}
                register={register}
                onRemove={() => remove(index)} 
              />
            ))}
            
            <button 
              type="button" 
              onClick={() => append({ name: '', type: 'apt' })}
              className="mt-4 px-4 py-2 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 transition"
            >
              + Add Build Step
            </button>
          </div>

          <button 
            type="submit" 
            className="w-full py-3 bg-green-600 text-white font-bold rounded shadow hover:bg-green-700 transition"
          >
            Generate Environment JSON
          </button>
        </div>

        {/* Right Column: Live JSON Preview */}
        <div className="w-[400px]">
          <div className="bg-gray-900 text-green-400 p-4 rounded shadow-lg overflow-auto h-[calc(100vh-4rem)] sticky top-8">
            <h3 className="text-white text-sm font-bold mb-2 uppercase tracking-wider">Live Schema Output</h3>
            <pre className="text-xs font-mono whitespace-pre-wrap">
              {JSON.stringify(watch(), null, 2)}
            </pre>
          </div>
        </div>

      </form>
    </div>
  );
};