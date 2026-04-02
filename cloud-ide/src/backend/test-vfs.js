// backend/test-vfs.js

const PORT = 3000;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runVfsTest() {
  console.log(`🚀 [Phase 1] Booting Temporary Sandbox for VFS Test...`);
  const sessionId = `vfs_test_${Date.now()}`;
  let targetSandboxId = null;
  
  try {
    // --- 1. BOOT SANDBOX ---
    // Note: Assuming env_base_python_3_11 exists from your previous tests
    const startRes = await fetch(`http://localhost:${PORT}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, envId: "env_base_python_3_11" })
    });
    
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(`Boot Failed: ${JSON.stringify(startData)}`);
    
    targetSandboxId = startData.sandboxId;
    console.log(`✅ Sandbox Booted! ID: ${targetSandboxId}`);
    
    // Give Docker a few seconds to fully initialize the container and volume
    console.log(`⏳ Waiting 3 seconds for container to settle...`);
    await delay(3000);

    // --- 2. TEST WRITE ---
    console.log(`\n📝 [Phase 2] Testing WRITE Endpoint...`);
    const writeRes = await fetch(`http://localhost:${PORT}/api/fs/${targetSandboxId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        path: "/workspace/cloud_ide_test.txt", 
        content: "Hello from the Virtual File System!\nThis is a base64 encoded test." 
      })
    });
    
    const writeData = await writeRes.json();
    if (!writeRes.ok) throw new Error(`Write Failed: ${JSON.stringify(writeData)}`);
    console.log(`✅ File successfully written to /workspace/cloud_ide_test.txt`);

    // --- 3. TEST LS (LIST) ---
    console.log(`\n🔍 [Phase 3] Testing LS Endpoint...`);
    const lsRes = await fetch(`http://localhost:${PORT}/api/fs/${targetSandboxId}/ls?path=/workspace`);
    const lsData = await lsRes.json();
    
    if (!lsRes.ok) throw new Error(`LS Failed: ${JSON.stringify(lsData)}`);
    console.log(`✅ Directory contents of /workspace:`, lsData);
    
    const fileExists = lsData.some(node => node.name === 'cloud_ide_test.txt');
    if (!fileExists) throw new Error("File was written but did not show up in LS!");

    // --- 4. TEST READ ---
    console.log(`\n📖 [Phase 4] Testing READ Endpoint...`);
    const readRes = await fetch(`http://localhost:${PORT}/api/fs/${targetSandboxId}/read?path=/workspace/cloud_ide_test.txt`);
    const readData = await readRes.json();
    
    if (!readRes.ok) throw new Error(`Read Failed: ${JSON.stringify(readData)}`);
    console.log(`✅ File Contents Retrieved:\n   "${readData.content.replace(/\n/g, '\\n')}"`);

    // --- 5. TEST DELETE ---
    console.log(`\n🗑️ [Phase 5] Testing DELETE Endpoint...`);
    const delRes = await fetch(`http://localhost:${PORT}/api/fs/${targetSandboxId}/delete?path=/workspace/cloud_ide_test.txt`, {
      method: 'DELETE'
    });
    
    const delData = await delRes.json();
    if (!delRes.ok) throw new Error(`Delete Failed: ${JSON.stringify(delData)}`);
    console.log(`✅ File successfully deleted!`);

    console.log(`\n🏆 ALL VFS TESTS PASSED! Your file system is bulletproof.`);

  } catch (err) {
    console.error(`\n❌ [TEST FAILED] ${err.message}`);
  } finally {
    // --- 6. CLEANUP ---
    if (targetSandboxId) {
      console.log(`\n🧹 Cleaning up... Destroying test sandbox.`);
      await fetch(`http://localhost:${PORT}/api/sessions/${sessionId}`, { method: 'DELETE' });
      console.log(`✅ Sandbox destroyed.`);
    }
  }
}

runVfsTest();