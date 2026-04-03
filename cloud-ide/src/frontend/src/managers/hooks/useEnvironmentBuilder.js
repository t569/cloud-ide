// frontend/src/managers/hooks/useEnvironmentBuilder.js
import { useState } from 'react';
import { Validator } from '@cloud-ide/shared/utils/Validator'; // Assuming this is a shared validation utility

// this hook manages the state and logic for our Environment Builder UI, 
// which allows users to create and customize their development environments.
// It provides functions to update the environment configuration,
// add/remove build steps, 
// and validate the final configuration before saving or deploying it.

export function useEnvironmentBuilder(initialData = null) {
  const [config, setConfig] = useState(initialData || {
    id: `env_${Date.now()}`,
    name: '',
    baseImage: 'ubuntu:22.04',
    buildSteps: [],
    env: {}
  });

  const updateConfig = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const addBuildStep = (type) => {
    const newStep = {
      name: `New ${type.toUpperCase()} Step`,
      type: type,
      packages: [],
      isGlobal: true
    };
    setConfig(prev => ({
      ...prev,
      buildSteps: [...prev.buildSteps, newStep]
    }));
  };

  const removeBuildStep = (index) => {
    setConfig(prev => ({
      ...prev,
      buildSteps: prev.buildSteps.filter((_, i) => i !== index)
    }));
  };

  const updateBuildStep = (index, updatedStep) => {
    setConfig(prev => {
      const newSteps = [...prev.buildSteps];
      newSteps[index] = updatedStep;
      return { ...prev, buildSteps: newSteps };
    });
  };

  const validate = () => {
    try {
      // Run it through the shared validator
      Validator.parseAndValidate(JSON.stringify(config));
      return { isValid: true, error: null };
    } catch (err) {
      return { isValid: false, error: err.message };
    }
  };

  return { config, updateConfig, addBuildStep, removeBuildStep, updateBuildStep, validate, setConfig };
}