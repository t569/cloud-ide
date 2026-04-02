// frontend/src/components/EnvironmentManager.jsx
import React, { useState, useEffect, useRef } from 'react';
import { VscClose, VscAdd, VscTrash, VscSearch } from 'react-icons/vsc';

// Utilities (Ensure these exist in your project)
import { DynamicPackageIcon, BaseImageIcon } from '../utils/packageIcons';
import { parsePackageString } from '../utils/packageParser';

// Terminal Integration
import { TerminalComponent } from '../terminal/components/Terminal';
import { streamDockerBuild } from '../api/buildStream';

// Configuration
import { API_BASE_URL } from "../config/env";

/**
 * EnvironmentManager Widget
 * * A 3-pane modal that allows users to construct custom Docker images 
 * by selecting base operating systems and injecting system/language packages.
 * Includes a real-time Terminal pane to view Docker compilation logs.
 */
export default function EnvironmentManager({ onClose, onBuildComplete }) {
  // ==========================================
  // 1. REFS & STATE
  // ==========================================
  const terminalRef = useRef(null);

  // Data State
  const [savedEnvs, setSavedEnvs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // UI/Build Status State
  const [isBuilding, setIsBuilding] = useState(false);
  
  // Form State
  const [profileName, setProfileName] = useState('');
  const [baseImage, setBaseImage] = useState('python:3.11');
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgVersion, setNewPkgVersion] = useState('');
  const [pkgType, setPkgType] = useState('language'); // 'system' | 'language'
  const [packages, setPackages] = useState([]);

  // ==========================================
  // 2. LIFECYCLE EFFECTS
  // ==========================================
  useEffect(() => {
    fetch(`${API_BASE_URL}/environment`)
      .then(res => res.json())
      .then(data => {
        setSavedEnvs(data);
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch environments:", err);
        setIsLoading(false);
      });
  }, []);

  // ==========================================
  // 3. UTILITY & HANDLER FUNCTIONS
  // ==========================================

  /**
   * Adds a new package to the current configuration state.
   * Validates input to prevent empty names or duplicates.
   */
  const handleAddPackage = () => {
    const trimmedName = newPkgName.trim();
    if (!trimmedName) return;

    // Check for duplicates in the current staging array
    const isDuplicate = packages.some(
      p => p.name.toLowerCase() === trimmedName.toLowerCase() && p.type === pkgType
    );

    if (isDuplicate) {
      alert(`Package '${trimmedName}' is already added to ${pkgType} packages.`);
      return;
    }

    const newPackage = {
      name: trimmedName,
      version: newPkgVersion.trim() || 'latest',
      type: pkgType
    };

    setPackages([...packages, newPackage]);
    
    // Reset inputs
    setNewPkgName('');
    setNewPkgVersion('');
  };

  /**
   * Removes a package from the staging area by its array index.
   * @param {number} indexToRemove 
   */
  const removePackage = (indexToRemove) => {
    setPackages(packages.filter((_, idx) => idx !== indexToRemove));
  };

  /**
   * Parses a backend IDEEnvironmentConfig and populates the UI form.
   * This bridges the gap between the nested JSON structure and the flat UI state.
   * @param {Object} env - The EnvironmentRecord from the backend
   */
  const loadSavedEnvironment = (env) => {
    setProfileName(env.displayName);
    
    // Safely extract config (fallback to defaults if malformed)
    const config = env.builderConfig || {};
    setBaseImage(config.baseImage || 'python:3.11');

    const loadedPackages = [];

    // Map System Packages
    if (Array.isArray(config.system)) {
      config.system.forEach(pkg => {
        loadedPackages.push({ name: pkg.name, version: pkg.version, type: 'system' });
      });
    }

    // Map Language Packages (Hybrid Global)
    if (config.languages && config.languages.workspace && Array.isArray(config.languages.workspace.hybridGlobalLibraries)) {
      config.languages.workspace.hybridGlobalLibraries.forEach(pkg => {
        loadedPackages.push({ name: pkg.name, version: pkg.version, type: 'language' });
      });
    }

    setPackages(loadedPackages);
  };

  /**
   * Checks if the currently constructed environment perfectly matches
   * an existing environment in the database to prevent duplicate Docker builds.
   * @param {Object} newConfigPayload - The constructed IDEEnvironmentConfig
   * @returns {Object|undefined} The matching environment record, or undefined
   */
  const findDuplicateEnvironment = (newConfigPayload) => {
    return savedEnvs.find(env => {
      // Deep compare the builder config objects
      return JSON.stringify(env.builderConfig) === JSON.stringify(newConfigPayload.builderConfig);
    });
  };

  /**
   * Constructs the final payload, validates it, and streams the build logs.
   */
  const handleSaveAndBuild = async () => {
    if (!profileName.trim()) {
      return alert("Please give this environment a name!");
    }
    if (!terminalRef.current) return;

    // Map flat UI state to the strict IDEEnvironmentConfig expected by backend
    const backendPayload = {
      id: `env_${profileName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now()}`,
      displayName: profileName,
      builderConfig: {
        baseImage: baseImage,
        system: packages
          .filter(p => p.type === 'system')
          .map(p => ({ name: p.name, version: p.version || 'latest' })),
        languages: {
          workspace: {
            hybridGlobalLibraries: packages
              .filter(p => p.type === 'language')
              .map(p => ({ name: p.name, version: p.version || 'latest' })),
            virtualEnvironments: [] 
          }
        }
      }
    };

    const duplicate = findDuplicateEnvironment(backendPayload);
    if (duplicate && duplicate.displayName !== profileName) {
      alert(`⚠️ Exact configuration already exists under the name '${duplicate.displayName}'!`);
      return; 
    }

    try {
      setIsBuilding(true);
      terminalRef.current.clear();
      
      // Stream logs via HTTP Chunked Transfer directly into xterm.js
      await streamDockerBuild(backendPayload, terminalRef.current);
      
      // Optional: Pass the environment ID up to start the sandbox
      if (onBuildComplete) {
        onBuildComplete(backendPayload.id); 
      }

    } catch (err) {
      terminalRef.current.write(`\r\n\x1b[31m[Error]\x1b[0m Failed to communicate with build server.\r\n`);
    } finally {
      setIsBuilding(false);
    }
  };

  // ==========================================
  // 4. RENDER
  // ==========================================
  const filteredEnvs = savedEnvs.filter(env => 
    env.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    env.builderConfig?.baseImage?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
      <div className="bg-vscode-sidebar border border-vscode-border rounded-lg w-[1200px] flex shadow-2xl font-sans h-[600px] overflow-hidden">
        
        {/* COLUMN 1: Saved Environments */}
        <div className="w-1/4 border-r border-vscode-border bg-vscode-bg flex flex-col">
           {/* UI Implementation for Saved Environments list goes here */}
           {/* Example: Map through `filteredEnvs` and onClick={loadSavedEnvironment(env)} */}
        </div>

        {/* COLUMN 2: Editor Form */}
        <div className="w-1/3 flex flex-col border-r border-vscode-border relative">
          
          {/* Overlay to block inputs while building */}
          {isBuilding && (
            <div className="absolute inset-0 bg-black/40 z-10 flex items-center justify-center backdrop-blur-[1px]">
              <span className="bg-vscode-accent text-white px-4 py-2 rounded shadow-lg font-bold text-sm animate-pulse">
                Compiling Image...
              </span>
            </div>
          )}

          <div className="px-4 py-3 border-b border-vscode-border">
            <h2 className="text-white font-bold tracking-wide text-sm">⚙️ Configure Environment</h2>
          </div>

          <div className="p-4 flex flex-col gap-4 text-sm overflow-y-auto flex-1">
             {/* Base Image Selection */}
             <div>
               <label className="text-gray-400 block mb-1">Base Image</label>
               <input 
                 className="w-full bg-vscode-input text-white border border-vscode-border rounded px-2 py-1"
                 value={baseImage}
                 onChange={e => setBaseImage(e.target.value)}
                 disabled={isBuilding}
               />
             </div>
             {/* TODO */ }
             {/* UI Implementation for adding packages (calling `handleAddPackage`) goes here */}
             {/* UI Implementation for mapping `packages` (calling `removePackage`) goes here */}
          </div>

          <div className="p-4 border-t border-vscode-border flex justify-end gap-3 bg-vscode-bg">
            <button onClick={onClose} disabled={isBuilding} className="px-4 py-2 rounded text-gray-300 hover:bg-vscode-border transition-colors text-xs font-bold disabled:opacity-50">Cancel</button>
            <button onClick={handleSaveAndBuild} disabled={isBuilding} className="px-4 py-2 rounded bg-vscode-accent hover:bg-blue-600 text-white transition-colors text-xs font-bold disabled:opacity-50">
              Save & Build Image
            </button>
          </div>
        </div>

        {/* COLUMN 3: The Terminal Build Logs */}
        <div className="w-[41.6%] bg-[#1e1e1e] flex flex-col">
           <div className="px-4 py-3 border-b border-vscode-border bg-vscode-sidebar flex justify-between items-center">
            <h2 className="text-gray-300 font-mono text-xs tracking-wider">BUILD_LOGS &gt;_</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><VscClose size={18} /></button>
          </div>
          
          <div className="flex-1 relative">
             <TerminalComponent isReadOnly={true} ref={terminalRef} />
          </div>
        </div>

      </div>
    </div>
  );
}