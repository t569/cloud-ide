// cloud-ide/backend/test-sandbox.js

async function runTest() {
  const PORT = 3000; 
  console.log(`🚀 [Test] Initiating Local Mount test on port ${PORT}...`);

  try {
    // 1. Fetch environments
    const envRes = await fetch(`http://localhost:${PORT}/api/environment`);
    const environments = await envRes.json();

    // Check if it's returning an object (our dictionary) instead of an array
    const envList = Array.isArray(environments) ? environments : Object.values(environments);

    if (!envList || envList.length === 0) {
      console.error('❌ No environments found in database.');
      return;
    }

    // Grab the Python Base environment
    const targetEnv = envList.find(e => e.id === 'env_base_python_3_11') || envList[0];
    
    // THE FIX: Pointing to the actual workspace directory
    const myLocalFolder = "C:/Users/Ejiro/Documents/Repos/drago/cloud-ide/workspace";

    console.log(`\n🚀 [Test] Booting container and mounting local path: ${myLocalFolder}`);
    
    // 2. Request Sandbox with Local Path
    const response = await fetch(`http://localhost:${PORT}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: `test_local_mount_${Date.now()}`,
        envId: targetEnv.id,
        localPath: myLocalFolder 
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ [Test Failed] Backend error:', data);
      return;
    }

    console.log('✅ [Test Passed] Container booted successfully!');
    console.log(`Sandbox ID: ${data.sandboxId}`);

    // 3. PROVE THE MOUNT WORKED using our new VFS route!
    console.log('\n🔍 [Test] Asking the Virtual File System what is inside /workspace...');
    
    // Give Docker 1 second to fully mount the files before asking
    await new Promise(resolve => setTimeout(resolve, 1000));

    const fsResponse = await fetch(`http://localhost:${PORT}/api/fs/${data.sandboxId}/ls?path=/workspace`);
    const files = await fsResponse.json();

    console.log('--- Container /workspace Contents ---');
    console.log(files);
    console.log('-------------------------------------');

  } catch (err) {
    console.error('❌ [Test Failed]:', err.message);
  }
}

runTest();