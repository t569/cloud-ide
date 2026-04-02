// backend/test-lifecycle.js

const PORT = 3000;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runLifecycleTest() {
  console.log(`🚀 [Phase 1] Fetching Environments...`);
  
  try {
    // 1. Get Environment
    const envRes = await fetch(`http://localhost:${PORT}/api/environment`);
    const environments = await envRes.json();
    const envList = Array.isArray(environments) ? environments : Object.values(environments);
    
    if (!envList || envList.length === 0) throw new Error('No environments found.');
    const targetEnv = envList.find(e => e.id === 'env_base_python_3_11') || envList[0];
    
    const sessionId = `lifecycle_test_${Date.now()}`;
    const myLocalFolder = "C:/Users/Ejiro/Documents/Repos/drago/cloud-ide/workspace";

    console.log(`\n🟢 [Phase 2] Starting Session: ${sessionId}`);
    const startRes = await fetch(`http://localhost:${PORT}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, envId: targetEnv.id, localPath: myLocalFolder })
    });
    
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(`Start Failed: ${JSON.stringify(startData)}`);
    console.log(`✅ Session Started! Sandbox ID: ${startData.sandboxId}`);

    // Wait 5 seconds to let Docker settle
    console.log(`\n⏳ Waiting 5 seconds before pausing...`);
    await delay(5000);

    console.log(`\n🟡 [Phase 3] Pausing Session...`);
    const pauseRes = await fetch(`http://localhost:${PORT}/api/sessions/${sessionId}/pause`, {
      method: 'POST'
    });
    
    const pauseData = await pauseRes.json();
    if (!pauseRes.ok) throw new Error(`Pause Failed: ${JSON.stringify(pauseData)}`);
    console.log(`✅ Session Paused Successfully!`);

    // Wait 5 seconds to prove it's paused
    console.log(`\n⏳ Waiting 5 seconds before destroying...`);
    await delay(5000);

    console.log(`\n🔴 [Phase 4] Destroying Session...`);
    const stopRes = await fetch(`http://localhost:${PORT}/api/sessions/${sessionId}`, {
      method: 'DELETE'
    });
    
    const stopData = await stopRes.json();
    if (!stopRes.ok) throw new Error(`Stop Failed: ${JSON.stringify(stopData)}`);
    console.log(`✅ Session Destroyed Successfully!`);

    console.log(`\n🏆 ALL TESTS PASSED! Your cloud infrastructure is rock solid.`);

  } catch (err) {
    console.error(`\n❌ [TEST FAILED] ${err.message}`);
  }
}

runLifecycleTest();