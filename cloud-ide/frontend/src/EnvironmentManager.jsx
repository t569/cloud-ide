import React, { useState, useEffect } from 'react';
import { VscClose, VscAdd, VscTrash, VscSearch } from 'react-icons/vsc';
import { getPackageIcon } from './utils/packageIcons';

export default function EnvironmentManager({ onClose, onBuild }) {
  // --- STATE ---
  const [savedEnvs, setSavedEnvs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState(''); // NEW: Search state
  
  const [profileName, setProfileName] = useState('');
  const [baseImage, setBaseImage] = useState('python:3.11');
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgVersion, setNewPkgVersion] = useState('');
  const [pkgType, setPkgType] = useState('language');
  const [packages, setPackages] = useState([]);

  // --- FETCH SAVED ENVIRONMENTS ON LOAD ---
  useEffect(() => {
    fetch('http://localhost:3001/api/environments')
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

  // --- HELPERS ---
  const handleAddPackage = (e) => {
    e.preventDefault();
    if (!newPkgName.trim()) return;

    const name = newPkgName.trim().toLowerCase();

    // 🚨 ECOSYSTEM VALIDATOR FIX
    if (pkgType === 'language') {
      const jsPackages = ['react', 'express', 'nodejs', 'nextjs', 'vue'];
      const pyPackages = ['pandas', 'numpy', 'tensorflow', 'flask', 'django'];

      if (baseImage.includes('python') && jsPackages.includes(name)) {
        return alert(`❌ Invalid Dependency!\n\nYou cannot install a JavaScript package (${name}) in a Python base environment via pip.\nChange the base image to Node.js, or add it as a System (apt-get) package if wrapper binaries exist.`);
      }
      if (baseImage.includes('node') && pyPackages.includes(name)) {
        return alert(`❌ Invalid Dependency!\n\nYou cannot install a Python package (${name}) in a Node.js base environment via npm.`);
      }
    }

    setPackages([...packages, { name, version: newPkgVersion.trim() || 'latest', type: pkgType }]);
    setNewPkgName(''); setNewPkgVersion('');
  };

  const removePackage = (indexToRemove) => {
    setPackages(packages.filter((_, idx) => idx !== indexToRemove));
  };

  const loadSavedEnvironment = (env) => {
    setProfileName(env.name);
    setBaseImage(env.base);
    setPackages([...env.packages.system, ...env.packages.language]);
  };

  // NEW: Deep Compare logic to find duplicates
  const findDuplicateEnvironment = (newConfig) => {
    return savedEnvs.find(saved => {
      if (saved.base !== newConfig.base) return false;

      const compareArrays = (arr1, arr2) => {
        if (arr1.length !== arr2.length) return false;
        // Sort alphabetically by package name to ensure order doesn't trigger a false negative
        const sorted1 = [...arr1].sort((a, b) => a.name.localeCompare(b.name));
        const sorted2 = [...arr2].sort((a, b) => a.name.localeCompare(b.name));
        return sorted1.every((pkg, i) => pkg.name === sorted2[i].name && pkg.version === sorted2[i].version);
      };

      const sysMatch = compareArrays(saved.packages.system, newConfig.packages.system);
      const langMatch = compareArrays(saved.packages.language, newConfig.packages.language);
      
      return sysMatch && langMatch;
    });
  };

  // --- SAVE & BUILD ---
  const handleSaveAndBuild = async () => {
    if (!profileName.trim()) return alert("Please give this environment a name!");

    const config = {
      name: profileName,
      base: baseImage,
      packages: {
        system: packages.filter(p => p.type === 'system'),
        language: packages.filter(p => p.type === 'language')
      }
    };

    // NEW: Intercept duplicates
    const duplicate = findDuplicateEnvironment(config);
    // Only alert if the duplicate has a different name (meaning they aren't just re-saving/building an existing one)
    if (duplicate && duplicate.name !== profileName) {
      alert(`⚠️ Exact configuration already exists!\n\nYou already saved this exact setup as "${duplicate.name}".\nPlease load that profile or add/remove packages to create a new one.`);
      return; 
    }

    try {
      // If it's a completely new environment, save it to the DB
      if (!duplicate) {
        await fetch('http://localhost:3001/api/environments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
      }
      onBuild(config);
    } catch (err) {
      alert("Failed to connect to backend database.");
    }
  };

  // NEW: Filter logic for the Search Bar
  const filteredEnvs = savedEnvs.filter(env => 
    env.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    env.base.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50">
      <div className="bg-vscode-sidebar border border-vscode-border rounded-lg w-[800px] flex shadow-2xl font-sans h-[500px]">
        
        {/* LEFT SIDEBAR: Saved Environments */}
        <div className="w-1/3 border-r border-vscode-border bg-vscode-bg flex flex-col rounded-l-lg">
          <div className="px-4 py-3 border-b border-vscode-border font-bold text-white tracking-wide text-sm flex justify-between items-center">
            <span>Profiles</span>
          </div>
          
          {/* NEW: Search Bar */}
          <div className="p-2 border-b border-vscode-border bg-vscode-sidebar">
            <div className="flex items-center bg-vscode-bg border border-vscode-border rounded px-2 py-1">
              <VscSearch className="text-gray-500 mr-2" size={14} />
              <input 
                placeholder="Search profiles..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-transparent text-white text-xs outline-none w-full"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {isLoading && <div className="text-gray-500 text-sm text-center mt-4">Loading...</div>}
            {!isLoading && filteredEnvs.length === 0 && <div className="text-gray-500 text-xs text-center mt-4">No matching profiles.</div>}
            
            {filteredEnvs.map(env => (
              <div 
                key={env.id} 
                onClick={() => loadSavedEnvironment(env)}
                className={`p-2 mb-1 rounded cursor-pointer border transition-colors text-sm text-gray-300 ${
                  profileName === env.name ? 'border-vscode-accent bg-vscode-sidebar' : 'border-transparent hover:border-vscode-border hover:bg-vscode-sidebar'
                }`}
              >
                <div className="font-bold text-white">{env.name}</div>
                <div className="text-xs text-vscode-textDim truncate">{env.base}</div>
              </div>
            ))}
          </div>
          <button onClick={() => { setProfileName(''); setPackages([]); }} className="m-2 p-2 bg-vscode-sidebar hover:bg-vscode-border text-white text-xs font-bold rounded border border-vscode-border transition-colors">
            + New Profile
          </button>
        </div>

        {/* RIGHT PANEL: Editor */}
        <div className="w-2/3 flex flex-col">
          <div className="px-4 py-3 border-b border-vscode-border flex justify-between items-center">
            <h2 className="text-white font-bold tracking-wide">⚙️ Configure Environment</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white"><VscClose size={20} /></button>
          </div>

          <div className="p-4 flex flex-col gap-4 text-sm overflow-y-auto flex-1">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-vscode-textDim mb-1 text-[10px] font-bold tracking-wider">PROFILE NAME</label>
                <input placeholder="e.g. Node Backend" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full bg-vscode-bg border border-vscode-border text-white p-2 rounded outline-none focus:border-vscode-accent" />
              </div>
              <div className="flex-1">
                <label className="block text-vscode-textDim mb-1 text-[10px] font-bold tracking-wider">BASE IMAGE</label>
                <select value={baseImage} onChange={(e) => setBaseImage(e.target.value)} className="w-full bg-vscode-bg border border-vscode-border text-white p-2 rounded outline-none focus:border-vscode-accent">
                  <option value="python:3.11">Python 3.11</option>
                  <option value="node:18">Node.js 18</option>
                  <option value="rust:latest">Rust (Latest)</option>
                  <option value="ubuntu:latest">Raw Ubuntu</option>
                </select>
              </div>
            </div>

            <div className="bg-vscode-bg p-3 rounded border border-vscode-border">
              <label className="block text-vscode-textDim mb-2 text-[10px] font-bold tracking-wider">ADD DEPENDENCY</label>
              <form onSubmit={handleAddPackage} className="flex gap-2">
                <select value={pkgType} onChange={(e) => setPkgType(e.target.value)} className="bg-vscode-sidebar border border-vscode-border text-white p-1.5 rounded outline-none text-xs">
                  <option value="language">Library</option>
                  <option value="system">System</option>
                </select>
                <input placeholder="Name (e.g. express)" value={newPkgName} onChange={(e) => setNewPkgName(e.target.value)} className="flex-1 bg-vscode-sidebar border border-vscode-border text-white p-1.5 rounded outline-none px-2" />
                <input placeholder="Ver (optional)" value={newPkgVersion} onChange={(e) => setNewPkgVersion(e.target.value)} className="w-24 bg-vscode-sidebar border border-vscode-border text-white p-1.5 rounded outline-none px-2" />
                <button type="submit" className="bg-vscode-border hover:bg-gray-600 text-white px-3 rounded flex items-center transition-colors"><VscAdd /></button>
              </form>
            </div>

            <div className="flex-1 min-h-[100px] border border-vscode-border rounded bg-vscode-bg p-2 overflow-y-auto">
              {packages.length === 0 && <div className="text-gray-500 text-center mt-6 text-xs">No dependencies added.</div>}
              {packages.map((pkg, idx) => (
                <div key={idx} className="flex justify-between items-center bg-vscode-sidebar p-2 mb-1 rounded border border-vscode-border group">
                  <div className="flex items-center gap-3">
                    <div className="text-lg">{getPackageIcon(pkg.name)}</div>
                    <div>
                      <span className="text-white font-mono text-sm">{pkg.name}</span>
                      {pkg.version !== 'latest' && <span className="text-xs text-gray-400 ml-2">v: {pkg.version}</span>}
                      <span className="text-[9px] ml-2 px-1 bg-vscode-border rounded text-gray-300 uppercase tracking-wider">{pkg.type}</span>
                    </div>
                  </div>
                  <button onClick={() => removePackage(idx)} className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><VscTrash size={16} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="p-4 border-t border-vscode-border flex justify-end gap-3 bg-vscode-bg rounded-br-lg">
            <button onClick={onClose} className="px-4 py-2 rounded text-gray-300 hover:bg-vscode-border transition-colors text-sm font-bold">Cancel</button>
            <button onClick={handleSaveAndBuild} className="px-4 py-2 rounded bg-vscode-accent hover:bg-blue-600 text-white transition-colors text-sm font-bold">Save & Build Image</button>
          </div>
        </div>

      </div>
    </div>
  );
}