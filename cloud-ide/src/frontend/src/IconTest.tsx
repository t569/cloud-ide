import React, { useState } from 'react';
import { fetchRepositoryTree } from './github'
import FileExplorer from './FileExplorerTest';
import { FileIcon } from '@frontend/common/FileIcon';
import { VscGithubInverted } from 'react-icons/vsc';

export default function App() {
  // Connection State
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [repoInfo, setRepoInfo] = useState({ owner: 'facebook', repo: 'react', token: '' });
  
  // File System State
  const [files, setFiles] = useState({});
  const [activeFile, setActiveFile] = useState<any>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsConnecting(true); 
    setError('');
    
    try {
      // Use your GitHub API helper to fetch the raw tree
      const tree = await fetchRepositoryTree(repoInfo.owner, repoInfo.repo, repoInfo.token);
      setFiles(tree);
      setIsConnected(true);
    } catch (err) {
      console.error(err);
      setError('Failed to connect. Check repository details or rate limits.');
    } finally {
      setIsConnecting(false);
    }
  };

  // --- RENDER CONNECTION SCREEN ---
  if (!isConnected) {
    return (
      <div className="flex justify-center items-center h-screen bg-[#1e1e1e] text-white font-sans">
        <form onSubmit={handleConnect} className="bg-[#252526] p-8 rounded-lg w-96 flex flex-col gap-4 shadow-2xl border border-[#3c3f41]">
          <div className="flex items-center gap-3 text-xl font-bold mb-2 text-[#cccccc]">
            <VscGithubInverted size={28} /> GitHub Icon Tester
          </div>
          {error && <div className="text-red-400 text-sm bg-red-900/30 p-2 rounded">{error}</div>}
          
          <input 
            placeholder="Owner (e.g., facebook)" 
            required 
            value={repoInfo.owner} 
            onChange={e => setRepoInfo({...repoInfo, owner: e.target.value})} 
            className="p-2 rounded bg-[#1e1e1e] border border-[#3c3f41] outline-none focus:border-[#4EC9B0] text-[#cccccc]" 
          />
          <input 
            placeholder="Repo (e.g., react)" 
            required 
            value={repoInfo.repo} 
            onChange={e => setRepoInfo({...repoInfo, repo: e.target.value})} 
            className="p-2 rounded bg-[#1e1e1e] border border-[#3c3f41] outline-none focus:border-[#4EC9B0] text-[#cccccc]" 
          />
          <input 
            placeholder="PAT (Optional for public repos)" 
            type="password" 
            value={repoInfo.token} 
            onChange={e => setRepoInfo({...repoInfo, token: e.target.value})} 
            className="p-2 rounded bg-[#1e1e1e] border border-[#3c3f41] outline-none focus:border-[#4EC9B0] text-[#cccccc]" 
          />
          
          <button 
            type="submit" 
            disabled={isConnecting} 
            className="mt-2 p-2 rounded bg-[#0e639c] text-white font-bold hover:bg-[#1177bb] disabled:bg-[#4d4d4d] transition-colors"
          >
            {isConnecting ? 'Pulling Repository...' : 'Fetch & Render Icons'}
          </button>
        </form>
      </div>
    );
  }

  // --- RENDER INSPECTOR SCREEN ---
  return (
    <div className="min-h-screen bg-[#1e1e1e] text-[#cccccc] font-sans p-8 flex justify-center">
      <div className="flex gap-8 w-full max-w-6xl h-[800px]">
        
        {/* Left Sidebar: Live GitHub File Explorer */}
        <div className="w-80 bg-[#252526] border border-[#3c3f41] rounded-lg shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 bg-[#2d2d2d] border-b border-[#3c3f41] flex justify-between items-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 truncate">
              {repoInfo.owner}/{repoInfo.repo}
            </span>
            <button 
              onClick={() => setIsConnected(false)}
              className="text-xs text-[#0e639c] hover:text-[#4EC9B0] transition-colors"
            >
              Change Repo
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#4b4d4f]">
            <FileExplorer 
              files={files} 
              activeFile={activeFile} 
              onSelectFile={(node) => setActiveFile(node)} 
            />
          </div>
        </div>

        {/* Right Panel: Resolution Inspector */}
        <div className="flex-1 bg-[#252526] border border-[#3c3f41] rounded-lg shadow-2xl p-6 flex flex-col items-center justify-center relative overflow-hidden">
          
          {/* Decorative background logo */}
          <div className="absolute opacity-5 pointer-events-none transform scale-[10]">
             {activeFile && <FileIcon fileName={activeFile.name} size={100} />}
          </div>

          {activeFile ? (
            <div className="flex flex-col items-center text-center gap-6 z-10">
              <div className="p-8 bg-[#1e1e1e]/80 backdrop-blur-sm rounded-2xl border border-[#3c3f41] shadow-2xl">
                <FileIcon fileName={activeFile.name} size={128} />
              </div>
              
              <div className="bg-[#1e1e1e]/80 backdrop-blur-sm px-6 py-4 rounded-lg border border-[#3c3f41]">
                <h2 className="text-3xl font-bold text-white font-jetbrains mb-2">
                  {activeFile.name}
                </h2>
                <div className="text-sm text-gray-400 font-mono break-all max-w-md">
                  {activeFile.path}
                </div>
              </div>
            </div>
          ) : (
            <div className="z-10 text-gray-500 flex flex-col items-center gap-4">
              <VscGithubInverted size={48} className="opacity-20" />
              <p>Select a file from the repository to inspect its icon.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}