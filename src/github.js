import { Octokit } from 'octokit';

// Helper to convert GitHub's flat path list into our nested UI state
function buildFileSystemTree(githubTree) {
  const root = { type: 'folder', isOpen: true, children: {} };

  githubTree.forEach((item) => {
    const parts = item.path.split('/');
    let currentNode = root;

    // Traverse/build the folder structure
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1 && item.type === 'blob';

      if (!currentNode.children[part]) {
        if (isFile) {
          currentNode.children[part] = {
            name: part,
            type: 'file',
            path: item.path, // Save full path for fetching content later
            url: item.url,
            sha: item.sha,
            content: null // We will fetch content lazily when clicked!
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

  return root.children;
}

export async function fetchRepositoryTree(owner, repo, token) {
  // Initialize Octokit with the token. 
  // If the token has the 'repo' scope, private repos will work automatically!
  const octokit = new Octokit({ auth: token });

  try {
    // 1. Get the repository data to find the default branch (e.g., main or master)
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoData.default_branch;

    // 2. Get the branch data to find the latest commit SHA
    const { data: branchData } = await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch: defaultBranch,
    });
    const treeSha = branchData.commit.commit.tree.sha;

    // 3. Fetch the entire tree recursively in one request!
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

// Function to fetch actual file content when a user clicks a tab
export async function fetchFileContent(owner, repo, path, token) {
  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo,
    path,
  });

  // GitHub returns file content Base64 encoded, so we must decode it
  return atob(data.content);
}

// Function to commit and push a single file change
export async function commitFileUpdate(owner, repo, path, content, sha, message, token) {
  const octokit = new Octokit({ auth: token });
  
  try {
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message, // The commit message
      content: btoa(unescape(encodeURIComponent(content))), // Encode to Base64 safely
      sha, // The current SHA of the file being replaced
    });
    
    // GitHub returns the NEW sha for the file after updating
    return data.content.sha; 
  } catch (error) {
    console.error("Failed to commit file:", error);
    throw error;
  }
}