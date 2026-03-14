import React, { useState } from 'react';
import { VscClose, VscAdd, VscTrash } from 'react-icons/vsc';
import { getPackageIcon } from './utils/packageIcons';

export default function EnvironmentManager({ onClose, onBuild }) {
  const [baseImage, setBaseImage] = useState('python:3.11');
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgVersion, setNewPkgVersion] = useState('');
  const [pkgType, setPkgType] = useState('language'); // 'language' (pip/npm) or 'system' (apt-get)
  
  const [packages, setPackages] = useState([
    { name: 'curl', version: 'latest', type: 'system' } // Default example
  ]);

  const handleAddPackage = (e) => {
    e.preventDefault();
    if (!newPkgName.trim()) return;
    
    setPackages([...packages, { 
      name: newPkgName.trim(), 
      version: newPkgVersion.trim() || 'latest',
      type: pkgType
    }]);
    setNewPkgName('');
    setNewPkgVersion('');
  };

  const removePackage = (indexToRemove) => {
    setPackages(packages.filter((_, idx) => idx !== indexToRemove));
  };

  const handleSaveAndBuild = () => {
    // Generate the final JSON configuration
    const config = {
      base: baseImage,
      packages: {
        system: packages.filter(p => p.type === 'system'),
        language: packages.filter(p => p.type === 'language')
      }
    };
    onBuild(config);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
      <div className="bg-vscode-sidebar border border-vscode-border rounded-lg w-[600px] shadow-2xl flex flex-col font-sans">
        
        {/* Header */}
        <div className="px-4 py-3 border-b border-vscode-border flex justify-between items-center">
          <h2 className="text-white font-bold tracking-wide">⚙️ Configure Environment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><VscClose size={20} /></button>
        </div>

        {/* Body */}
        <div className="p-4 flex flex-col gap-4 text-sm">
          
          {/* Base Image */}
          <div>
            <label className="block text-vscode-textDim mb-1 text-xs font-bold">BASE IMAGE</label>
            <select 
              value={baseImage} 
              onChange={(e) => setBaseImage(e.target.value)}
              className="w-full bg-vscode-bg border border-vscode-border text-white p-2 rounded outline-none focus:border-vscode-accent"
            >
              <option value="python:3.11">Python 3.11 (Debian)</option>
              <option value="node:18">Node.js 18 (Debian)</option>
              <option value="rust:latest">Rust (Latest)</option>
              <option value="ubuntu:latest">Raw Ubuntu Bash</option>
            </select>
          </div>

          {/* Add Package Form */}
          <div className="bg-vscode-bg p-3 rounded border border-vscode-border">
            <label className="block text-vscode-textDim mb-2 text-xs font-bold">ADD DEPENDENCY</label>
            <form onSubmit={handleAddPackage} className="flex gap-2">
              <select 
                value={pkgType} 
                onChange={(e) => setPkgType(e.target.value)}
                className="bg-vscode-sidebar border border-vscode-border text-white p-1.5 rounded outline-none"
              >
                <option value="language">Library (pip/npm)</option>
                <option value="system">System (apt-get)</option>
              </select>
              <input 
                placeholder="Name (e.g. pandas)" 
                value={newPkgName} 
                onChange={(e) => setNewPkgName(e.target.value)}
                className="flex-1 bg-vscode-sidebar border border-vscode-border text-white p-1.5 rounded outline-none px-2"
              />
              <input 
                placeholder="Version (e.g. 2.0.3)" 
                value={newPkgVersion} 
                onChange={(e) => setNewPkgVersion(e.target.value)}
                className="w-24 bg-vscode-sidebar border border-vscode-border text-white p-1.5 rounded outline-none px-2"
              />
              <button type="submit" className="bg-vscode-border hover:bg-gray-600 text-white px-3 rounded flex items-center transition-colors">
                <VscAdd />
              </button>
            </form>
          </div>

          {/* Package List */}
          <div className="flex-1 min-h-[150px] max-h-[250px] overflow-y-auto border border-vscode-border rounded bg-vscode-bg p-2">
            {packages.length === 0 && <div className="text-gray-500 text-center mt-10">No dependencies added.</div>}
            {packages.map((pkg, idx) => (
              <div key={idx} className="flex justify-between items-center bg-vscode-sidebar p-2 mb-1 rounded border border-vscode-border group">
                <div className="flex items-center gap-3">
                  <div className="text-lg">{getPackageIcon(pkg.name)}</div>
                  <div>
                    <span className="text-white font-mono">{pkg.name}</span>
                    <span className="text-xs text-gray-400 ml-2">v: {pkg.version}</span>
                    <span className="text-[10px] ml-2 px-1 bg-vscode-border rounded text-gray-300 uppercase tracking-wider">{pkg.type}</span>
                  </div>
                </div>
                <button onClick={() => removePackage(idx)} className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                  <VscTrash size={16} />
                </button>
              </div>
            ))}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-vscode-border flex justify-end gap-3 bg-vscode-bg rounded-b-lg">
          <button onClick={onClose} className="px-4 py-2 rounded text-gray-300 hover:bg-vscode-border transition-colors text-sm font-bold">
            Cancel
          </button>
          <button onClick={handleSaveAndBuild} className="px-4 py-2 rounded bg-vscode-accent hover:bg-blue-600 text-white transition-colors text-sm font-bold">
            Save & Build Image
          </button>
        </div>

      </div>
    </div>
  );
}