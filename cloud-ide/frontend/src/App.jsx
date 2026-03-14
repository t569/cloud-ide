import React, { useState, useEffect } from 'react';
import EditorComponent from './EditorComponent';
import TerminalComponent from './TerminalComponent';
import FileExplorer from './FileExplorer';
import EnvironmentManager from './EnvironmentManager';


import { fetchRepositoryTree, fetchFileContent } from './github'; 
import { VscClose, VscGithubInverted } from 'react-icons/vsc';
import { getFileIcon } from './utils/icons';

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  
  const [repoInfo, setRepoInfo] = useState({ owner: '', repo: '', token: '' });
  const [files, setFiles] = useState({});
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  
  const [terminalEnv, setTerminalEnv] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  const [showEnvManager, setShowEnvManager] = useState(false);

  // --- HANDLERS (Same as before) ---
  const handleConnect = async (e) => {
    e.preventDefault();
    setIsConnecting(true); setError('');
    try {
      const tree = await fetchRepositoryTree(repoInfo.owner, repoInfo.repo, repoInfo.token);
      setFiles(tree);
      setIsConnected(true);
    } catch (err) {
      setError('Failed to connect. Check your repo details.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleOpenFile = async (fileNode) => {
    if (fileNode.type === 'file' && fileNode.content === null) {
      setIsLoadingFile(true);
      try {
        fileNode.content = await fetchFileContent(repoInfo.owner, repoInfo.repo, fileNode.path, repoInfo.token);
      } catch (err) {
        fileNode.content = "// Error loading file content.";
      } finally {
        setIsLoadingFile(false);
      }
    }
    const isAlreadyOpen = openFiles.find(f => f.path === fileNode.path);
    if (!isAlreadyOpen) setOpenFiles([...openFiles, fileNode]);
    setActiveFile(fileNode);
  };

  const handleCloseTab = (e, fileToClose) => {
    e.stopPropagation();
    const newOpenFiles = openFiles.filter(f => f.path !== fileToClose.path);
    setOpenFiles(newOpenFiles);
    if (activeFile?.path === fileToClose.path) {
      setActiveFile(newOpenFiles.length > 0 ? newOpenFiles[newOpenFiles.length - 1] : null);
    }
  };

  const handleSaveAndCommit = async () => {
    if (!activeFile || !repoInfo.token) return alert("Requires an open file and access token.");
    const finalMessage = commitMessage.trim() || `Update ${activeFile.name}`;
    setIsCommitting(true);
    try {
      const { commitFileUpdate } = await import('./github');
      activeFile.sha = await commitFileUpdate(repoInfo.owner, repoInfo.repo, activeFile.path, activeFile.content, activeFile.sha, finalMessage, repoInfo.token);
      setCommitMessage('');
      alert("Successfully committed! 🎉");
    } catch (err) {
      alert("Failed to commit.");
    } finally {
      setIsCommitting(false);
    }
  };

  // This is to handle building of the environment into the custom json file
  const handleBuildEnvironment = (config) => {
    setShowEnvManager(false);
    
    // We will soon send this config to the backend via WebSocket!
    // For now, let's just log it to ensure our JSON structure is perfect.
    console.log("Saving ide-env.json to GitHub...", config);
    alert("Environment Configured! (Check console for JSON payload)");
    
    // Switch the terminal view to the Remote Linux environment so we are ready
    setTerminalEnv('remote-linux');
  };

  // --- RENDER CONNECTION SCREEN ---
  if (!isConnected) {
    return (
      <div className="flex justify-center items-center h-screen bg-vscode-bg text-white">
        <form onSubmit={handleConnect} className="bg-vscode-tab p-8 rounded-lg w-96 flex flex-col gap-4 shadow-2xl border border-vscode-border">
          <div className="flex items-center gap-3 text-xl font-bold mb-2">
            <VscGithubInverted size={28} /> Connect to GitHub
          </div>
          {error && <div className="text-red-400 text-sm bg-red-900/30 p-2 rounded">{error}</div>}
          <input placeholder="Owner (e.g., facebook)" required value={repoInfo.owner} onChange={e => setRepoInfo({...repoInfo, owner: e.target.value})} className="p-2 rounded bg-vscode-bg border border-vscode-border outline-none focus:border-vscode-accent" />
          <input placeholder="Repo (e.g., react)" required value={repoInfo.repo} onChange={e => setRepoInfo({...repoInfo, repo: e.target.value})} className="p-2 rounded bg-vscode-bg border border-vscode-border outline-none focus:border-vscode-accent" />
          <input placeholder="Personal Access Token" type="password" value={repoInfo.token} onChange={e => setRepoInfo({...repoInfo, token: e.target.value})} className="p-2 rounded bg-vscode-bg border border-vscode-border outline-none focus:border-vscode-accent" />
          <button type="submit" disabled={isConnecting} className="mt-2 p-2 rounded bg-vscode-accent text-white font-bold hover:bg-blue-600 disabled:bg-gray-600 transition-colors">
            {isConnecting ? 'Fetching Tree...' : 'Connect IDE'}
          </button>
        </form>
      </div>
    );
  }

  // --- RENDER IDE SCREEN ---
  return (
    <div className="flex h-screen w-screen bg-vscode-bg text-white font-sans overflow-hidden">
      
      {/* Sidebar */}
      <div className="w-64 border-r border-vscode-border flex flex-col">
        <div className="px-4 py-2 text-xs font-bold tracking-wider border-b border-vscode-border text-vscode-textDim flex justify-between items-center">
          <span>EXPLORER</span>
          <span className="text-vscode-accent cursor-pointer hover:underline" onClick={() => setIsConnected(false)}>Disconnect</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FileExplorer files={files} activeFile={activeFile} onSelectFile={handleOpenFile} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Editor Area */}
        <div className="flex-[2] flex flex-col border-b border-vscode-border min-h-0">
          
          {/* Tabs */}
          <div className="flex bg-vscode-sidebar overflow-x-auto scrollbar-hide">
            {openFiles.map(file => {
              const isActive = activeFile?.path === file.path;
              return (
                <div key={file.path} onClick={() => setActiveFile(file)} className={`flex items-center gap-2 px-4 py-2 text-sm cursor-pointer border-t-2 border-r border-r-vscode-border min-w-max transition-colors ${isActive ? 'bg-vscode-bg border-t-vscode-accent text-white' : 'bg-vscode-tab border-t-transparent text-gray-400 hover:bg-[#333]'}`}>
                  {getFileIcon(file.name)}
                  {file.name}
                  <div onClick={(e) => handleCloseTab(e, file)} className="ml-2 p-0.5 rounded hover:bg-vscode-border flex items-center justify-center">
                    <VscClose size={16} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Bar */}
          <div className="bg-vscode-tab border-b border-vscode-border p-2 flex justify-end items-center gap-3">
            <button onClick={() => window.dispatchEvent(new CustomEvent('run-terminal-code', { detail: activeFile }))} className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-bold transition-colors">
              ▶️ Run File
            </button>
            <div className="flex gap-2">
              <input type="text" placeholder={`Commit message (Default: Update ${activeFile?.name})`} value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} className="bg-vscode-bg text-white border border-vscode-border rounded px-3 py-1 text-xs w-64 outline-none focus:border-vscode-accent" />
              <button onClick={handleSaveAndCommit} disabled={!activeFile || isCommitting} className="bg-vscode-accent hover:bg-blue-600 disabled:bg-gray-600 text-white px-3 py-1 rounded text-xs font-bold transition-colors">
                {isCommitting ? 'Pushing...' : '🚀 Commit & Push'}
              </button>
            </div>
          </div>

          {/* Editor Container */}
          <div className="flex-1 min-h-0 relative">
            {isLoadingFile ? (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500">Loading from GitHub...</div>
            ) : activeFile ? (
              <EditorComponent file={activeFile} onChange={(newContent) => { activeFile.content = newContent; setActiveFile({ ...activeFile }); }} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xl">Open a file to start editing</div>
            )}
          </div>
        </div>

        {/* Terminal Area */}
        <div className="flex-1 flex flex-col bg-vscode-bg min-h-0">
          <div className="bg-vscode-sidebar px-3 py-1 flex justify-between items-center border-b border-vscode-border">
            <span className="text-xs text-vscode-textDim tracking-wider font-bold">TERMINAL</span>
            <div className="flex gap-3 items-center">
              {/* NEW: Configure Environment Button */}
              <button 
                onClick={() => setShowEnvManager(true)} 
                className="bg-vscode-accent hover:bg-blue-600 text-white rounded px-2 py-0.5 text-xs font-bold transition-colors"
              >
                ⚙️ Configure Env
              </button>
              <button onClick={() => window.dispatchEvent(new Event('copy-terminal'))} className="bg-vscode-border hover:bg-gray-600 text-white border border-gray-600 rounded px-2 py-0.5 text-xs transition-colors">
                📋 Copy
              </button>
              <select value={terminalEnv} onChange={(e) => setTerminalEnv(e.target.value)} className="bg-vscode-border text-white border border-gray-600 rounded px-2 py-0.5 text-xs outline-none">
                  <option value="" disabled>Select Environment...</option>
                  <option value="python-wasm">Local WASM (Python)</option>
                  <option value="js-worker">Local Worker (JS)</option>
                  <option value="remote-linux">Remote Server (Docker)</option>
                  <option value="ruby-wasm">Local WASM (Ruby)</option>
              </select>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <TerminalComponent environment={terminalEnv} files={files} />
          </div>
        </div>


        {/* Render the Modal overlay if active */}
        {showEnvManager && (
          <EnvironmentManager 
            onClose={() => setShowEnvManager(false)} 
            onBuild={handleBuildEnvironment} 
          />
        )}
      </div>
    </div>
  );
}