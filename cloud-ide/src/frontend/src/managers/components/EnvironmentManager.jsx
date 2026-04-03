// frontend/src/managers/components/EnvironmentManager.jsx (Refactored)
import React, { useRef, useState } from 'react';
import { useEnvironmentBuilder } from '../hooks/useEnvironmentBuilder';
import { BuildStepEditor } from './BuildStepEditorjsx';
import { TerminalComponent } from '../../terminal/components/Terminal';
import { InstallStepType } from '@cloud-ide/shared/types/env'; // Assuming this is exported

export default function EnvironmentManager({ onClose }) {
  const terminalRef = useRef(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const { config, updateConfig, addBuildStep, removeBuildStep, updateBuildStep, validate } = useEnvironmentBuilder();

  const handleSaveAndBuild = async () => {
    const { isValid, error } = validate();
    if (!isValid) {
      return alert(error); // Frontend guardrail catches issues before submission
    }

    try {
      setIsBuilding(true);
      terminalRef.current?.clear();
      
      // The payload is already perfectly structured as an EnvironmentConfig!
      await streamDockerBuild(config, terminalRef.current);
      
    } catch (err) {
      terminalRef.current?.write(`\r\n\x1b[31m[Error]\x1b[0m Build failed.\r\n`);
    } finally {
      setIsBuilding(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
      <div className="bg-vscode-sidebar border border-vscode-border rounded-lg w-[1200px] flex shadow-2xl h-[600px] overflow-hidden">
        
        {/* ... Sidebar rendering Saved Environments goes here ... */}

        {/* EDITOR FORM */}
        <div className="w-1/2 flex flex-col border-r border-vscode-border">
          <div className="p-4 flex flex-col gap-4 text-sm overflow-y-auto flex-1">
            
            <input 
               className="bg-transparent text-xl text-white font-bold mb-2 focus:outline-none"
               placeholder="Environment Name"
               value={config.name}
               onChange={e => updateConfig('name', e.target.value)}
            />

            <div>
              <label className="text-gray-400 block mb-1 text-xs uppercase tracking-wider">Base Image</label>
              <input 
                className="w-full bg-vscode-input text-white border border-vscode-border rounded px-2 py-2"
                value={config.baseImage}
                onChange={e => updateConfig('baseImage', e.target.value)}
              />
            </div>

            <div className="mt-4">
              <label className="text-gray-400 block mb-2 text-xs uppercase tracking-wider">Build Steps</label>
              {config.buildSteps.map((step, idx) => (
                <BuildStepEditor 
                  key={idx} 
                  index={idx} 
                  step={step} 
                  baseImage={config.baseImage}
                  onUpdate={updateBuildStep} 
                  onRemove={removeBuildStep} 
                />
              ))}

              <div className="flex flex-wrap gap-2 mt-2">
                // TODO: make this a map
                {['apt', 'npm', 'pip', 'cargo', 'go', 'shell'].map(type => (
                  <button 
                    key={type}
                    onClick={() => addBuildStep(type)}
                    className="bg-[#2d2d2d] hover:bg-[#3d3d3d] border border-vscode-border text-gray-300 px-3 py-1 rounded text-xs"
                  >
                    + Add {type}
                  </button>
                ))}
              </div>
            </div>

          </div>
          
          <div className="p-4 border-t border-vscode-border flex justify-end gap-3 bg-vscode-bg">
            <button onClick={onClose} className="px-4 py-2 text-gray-300 text-xs font-bold">Cancel</button>
            <button onClick={handleSaveAndBuild} className="px-4 py-2 bg-vscode-accent text-white rounded text-xs font-bold">
              Validate & Build
            </button>
          </div>
        </div>

        {/* TERMINAL PANE */}
        <div className="w-1/4 bg-[#1e1e1e]">
          <TerminalComponent isReadOnly={true} ref={terminalRef} />
        </div>

      </div>
    </div>
  );
}