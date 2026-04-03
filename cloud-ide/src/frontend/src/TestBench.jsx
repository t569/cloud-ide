import React from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { BuildStepCard } from './components/env-manager/BuildStepCard'; // Adjust path as needed

const TestBench = () => {
  // 1. Initialize the form with dummy data
  const { control, register, handleSubmit, setValue } = useForm({
    defaultValues: {
      baseImage: 'ubuntu:22.04',
      buildSteps: [
        {
          type: 'pip',
          name: 'Backend Dependencies',
          packages: ['fastapi', 'uvicorn', 'pydantic'],
          isGlobal: false,
          targetPath: '/app'
        },
        {
          type: 'npm',
          name: 'Frontend Setup',
          packages: ['react', 'tailwindcss', 'vite'],
          isGlobal: true,
          targetPath: ''
        }
      ]
    }
  });

  // 2. Use field array to manage the list of cards
  const { fields, append, remove } = useFieldArray({
    control,
    name: "buildSteps"
  });

  const onSubmit = (data) => console.log("Form Data:", data);

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-2xl mx-auto">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-gray-800">Icon System Test Bench</h1>
          <p className="text-gray-600 text-sm">
            Try changing the <b>Type</b> or adding <b>comma-separated packages</b>.
          </p>
        </header>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

          <div className="flex gap-4 mt-6">
            <button
              type="button"
              onClick={() => append({ type: 'apt', name: '', packages: [], isGlobal: true })}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors shadow-sm font-medium"
            >
              + Add Build Step
            </button>
            
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors shadow-sm font-medium"
            >
              Log Configuration
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TestBench;