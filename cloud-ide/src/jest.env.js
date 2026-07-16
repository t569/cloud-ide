// Test-environment defaults, loaded before any module (setupFiles).
//
// SANDBOX_EGRESS=off: the capability gate's 'auto' default probes the kernel by
// RUNNING A REAL DOCKER CONTAINER (~5s, memoized per process). Every jest worker
// whose tests touch provision() paid that probe, pushing them past the 5s default
// timeout under full-suite parallelism — in isolation they passed at ~4.9s, in the
// suite they flaked. The gate itself is covered by egressCapability.test.ts, which
// sets/deletes this var per case (jest.resetModules), so the default here never
// reaches it.
process.env.SANDBOX_EGRESS = 'off';
