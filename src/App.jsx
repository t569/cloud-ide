import React, { useState } from 'react';
import EditorComponent from './EditorComponent';
import TerminalComponent from './TerminalComponent';
import FileExplorer from './FileExplorer';
import { fetchRepositoryTree, fetchFileContent } from './github'; // Import our new service!
import { SiJavascript, SiPython, SiHtml5, SiReact } from 'react-icons/si';
import { VscFile, VscClose, VscGithubInverted } from 'react-icons/vsc';
import './App.css';

const getFileIcon = (name) => {
  if (name.endsWith('.js')) return <SiJavascript color="#f7df1e" size={14} />;
  if (name.endsWith('.jsx')) return <SiReact color="#61dafb" size={14} />;
  if (name.endsWith('.py')) return <SiPython color="#3776ab" size={14} />;
  if (name.endsWith('.html')) return <SiHtml5 color="#e34f26" size={14} />;
  return <VscFile color="#cccccc" size={14} />;
};

export default function App() {
  // --- GITHUB CONNECTION STATE ---
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  
  const [repoInfo, setRepoInfo] = useState({
    owner: '',
    repo: '',
    token: '' // Needs 'repo' scope for private repositories
  });

  // --- IDE STATE ---
  const [files, setFiles] = useState({});
  const [openFiles, setOpenFiles] = useState([]);
  const [activeFile, setActiveFile] = useState(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // --- HANDLERS ---
  const handleConnect = async (e) => {
    e.preventDefault();
    setIsConnecting(true);
    setError('');

    try {
      const tree = await fetchRepositoryTree(repoInfo.owner, repoInfo.repo, repoInfo.token);
      setFiles(tree);
      setIsConnected(true);
    } catch (err) {
      setError('Failed to connect. Check your repo details and token permissions.');
      console.error(err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleOpenFile = async (fileNode) => {
    // 1. If it's a file we haven't fetched the content for yet:
    if (fileNode.type === 'file' && fileNode.content === null) {
      setIsLoadingFile(true);
      try {
        const content = await fetchFileContent(repoInfo.owner, repoInfo.repo, fileNode.path, repoInfo.token);
        fileNode.content = content; // Mutate the node to store the content locally
      } catch (err) {
        console.error("Failed to fetch file:", err);
        fileNode.content = "// Error loading file content.";
      } finally {
        setIsLoadingFile(false);
      }
    }

    // 2. Add to open tabs if not already open
    const isAlreadyOpen = openFiles.find(f => f.path === fileNode.path);
    if (!isAlreadyOpen) {
      setOpenFiles([...openFiles, fileNode]);
    }
    
    // 3. Set as active
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

  const handleEditorChange = (newContent) => {
    if (activeFile) {
      activeFile.content = newContent;
      setActiveFile({ ...activeFile });
    }
  };

  // --- RENDER CONNECTION SCREEN ---
  if (!isConnected) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#1e1e1e', color: '#fff' }}>
        <form onSubmit={handleConnect} style={{ backgroundColor: '#2d2d2d', padding: '30px', borderRadius: '8px', width: '350px', display: 'flex', flexDirection: 'column', gap: '15px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '20px', fontWeight: 'bold', marginBottom: '10px' }}>
            <VscGithubInverted size={28} /> Connect to GitHub
          </div>
          
          {error && <div style={{ color: '#f48771', fontSize: '13px', backgroundColor: '#3a1d1d', padding: '8px', borderRadius: '4px' }}>{error}</div>}

          <input placeholder="Owner (e.g., facebook)" required value={repoInfo.owner} onChange={e => setRepoInfo({...repoInfo, owner: e.target.value})} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#1e1e1e', color: '#fff' }} />
          <input placeholder="Repo (e.g., react)" required value={repoInfo.repo} onChange={e => setRepoInfo({...repoInfo, repo: e.target.value})} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#1e1e1e', color: '#fff' }} />
          <input placeholder="Personal Access Token (Required for Private)" type="password" value={repoInfo.token} onChange={e => setRepoInfo({...repoInfo, token: e.target.value})} style={{ padding: '10px', borderRadius: '4px', border: '1px solid #444', backgroundColor: '#1e1e1e', color: '#fff' }} />
          
          <button type="submit" disabled={isConnecting} style={{ padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: '#007acc', color: '#fff', fontWeight: 'bold', cursor: isConnecting ? 'not-allowed' : 'pointer', marginTop: '10px' }}>
            {isConnecting ? 'Fetching Tree...' : 'Connect IDE'}
          </button>
        </form>
      </div>
    );
  }

  // --- RENDER IDE SCREEN ---
  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', backgroundColor: '#1e1e1e', color: '#fff', fontFamily: 'sans-serif' }}>
      
      {/* Sidebar */}
      <div style={{ width: '250px', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 15px', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px', borderBottom: '1px solid #333', color: '#ccc', display: 'flex', justifyContent: 'space-between' }}>
          <span>EXPLORER</span>
          <span style={{ color: '#007acc', cursor: 'pointer' }} onClick={() => setIsConnected(false)}>Disconnect</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <FileExplorer files={files} activeFile={activeFile} onSelectFile={handleOpenFile} />
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Editor Area */}
        <div style={{ flex: 2, borderBottom: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* Tabs */}
          <div style={{ display: 'flex', backgroundColor: '#252526', overflowX: 'auto' }}>
            {openFiles.map(file => {
              const isActive = activeFile?.path === file.path;
              return (
                <div key={file.path} onClick={() => setActiveFile(file)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 15px', fontSize: '13px', cursor: 'pointer', backgroundColor: isActive ? '#1e1e1e' : '#2d2d2d', borderTop: isActive ? '2px solid #007acc' : '2px solid transparent', borderRight: '1px solid #333', minWidth: 'fit-content', color: isActive ? '#fff' : '#888' }}>
                  {getFileIcon(file.name)}
                  {file.name}
                  <div onClick={(e) => handleCloseTab(e, file)} style={{ marginLeft: '8px', display: 'flex', alignItems: 'center', padding: '2px', borderRadius: '4px' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#333'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <VscClose size={14} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Editor */}
          <div style={{ flex: 1 }}>
            {isLoadingFile ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#888' }}>Loading file from GitHub...</div>
            ) : activeFile ? (
              <EditorComponent file={activeFile} onChange={handleEditorChange} />
            ) : (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: '#555', fontSize: '24px' }}>Open a file to start editing</div>
            )}
          </div>
        </div>

        {/* Terminal */}
        <div style={{ flex: 1, backgroundColor: '#1e1e1e', padding: 0, borderTop: '1px solid #333', overflow: 'hidden' }}>
          <TerminalComponent />
        </div>

      </div>
    </div>
  );
}