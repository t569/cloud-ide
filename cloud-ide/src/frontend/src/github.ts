import { Octokit } from 'octokit';
import { FileNodeData } from './FileExplorerTest'; // Import the type we made earlier!

// Helper to convert GitHub's flat path list into our nested UI state
function buildFileSystemTree(githubTree: any[]): Record<string, FileNodeData> {
  const root: FileNodeData = { name: 'root', type: 'folder', isOpen: true, children: {} };

  githubTree.forEach((item) => {
    const parts = item.path.split('/');
    let currentNode = root;

    // Traverse/build the folder structure
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1 && item.type === 'blob';

      if (!currentNode.children) {
        currentNode.children = {};
      }

      if (!currentNode.children[part]) {
        if (isFile) {
          currentNode.children[part] = {
            name: part,
            type: 'file',
            path: item.path, 
            url: item.url,
            sha: item.sha,
            content: null 
          };
        } else {
          currentNode.children[part] = {
            name: part,
            type: 'folder',
            isOpen: false,
            children: {}
          };
        }
      }
      currentNode = currentNode.children[part];
    }
  });

  return root.children || {};
}

export async function fetchRepositoryTree(owner: string, repo: string, token: string): Promise<Record<string, FileNodeData>> {
  const octokit = new Octokit({ auth: token });

  try {
    // 1. Get the repository data to find the default branch
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    // 2. Get the branch data to find the latest commit SHA
    const { data: branchData } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: defaultBranch,
    });
    const treeSha = branchData.commit.commit.tree.sha;

    // 3. Fetch the entire tree recursively
    const { data: treeData } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: '1',
    });

    // 4. Convert it to our UI state
    return buildFileSystemTree(treeData.tree);

  } catch (error) {
    console.error("Error fetching repository:", error);
    throw error;
  }
}

// Function to fetch actual file content
export async function fetchFileContent(owner: string, repo: string, path: string, token: string): Promise<string> {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
  });

  // @ts-ignore - GitHub returns content in this specific endpoint but TS doesn't always know it
  return atob(data.content);
}

// Function to commit and push a single file change
export async function commitFileUpdate(owner: string, repo: string, path: string, content: string, sha: string, message: string, token: string): Promise<string> {
  const octokit = new Octokit({ auth: token });
  
  try {
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message, 
      content: btoa(unescape(encodeURIComponent(content))), 
      sha, 
    });
    
    return data.content?.sha || ''; 
  } catch (error) {
    console.error("Failed to commit file:", error);
    throw error;
  }
}