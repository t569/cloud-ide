// Builds the napi Rust engine for THIS host's Node ABI, then proves it loads.
//
// Why this exists: `napi build` compiles fine with the wrong toolchain and only
// fails at runtime with "Module did not self-register". A napi .node must match
// the host Node's ABI — there is exactly one correct Rust target per machine, not
// "any tool". This script picks that target, checks it's installed, builds, then
// require()s the result so a mismatch fails HERE with a fix, not in production.
//
// Plain .mjs on purpose: it runs before `tsc`, so it can't be TypeScript itself.
// ponytail: detect-and-guide only — never mutates the toolchain. Add `rustup
// target add` auto-install when a CI matrix needs cross-builds.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const binary = resolve(backendRoot, 'index.node');

// Host Node ABI -> the one Rust target that will load into it.
// win32 is forced to -msvc: official node.exe is MSVC-built (see backend README).
const TARGETS = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
};

const key = `${process.platform}-${process.arch}`;
const target = TARGETS[key];

function die(msg) {
  console.error(`\n[build-rust] ✗ ${msg}\n`);
  process.exit(1);
}

// shell:true so Windows .cmd/.ps1 shims (napi, cargo, rustup) resolve on PATH.
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: backendRoot, shell: true, encoding: 'utf8', ...opts });
}

if (!target) {
  die(`No known Rust target for ${key}. Add it to TARGETS in scripts/build-rust.mjs.`);
}

// 1. Toolchain must exist.
if (run('cargo', ['--version']).status !== 0) {
  die(`cargo not found. Install Rust: https://rustup.rs\nThen: rustup default stable`);
}

// 2. Target must be installed. If rustup is absent (distro rust), the host target
//    is implicit — skip the check and let the build speak.
const installed = run('rustup', ['target', 'list', '--installed']);
if (installed.status === 0 && !installed.stdout.split('\n').includes(target)) {
  die(`Rust target '${target}' is not installed for this Node ABI.\nFix: rustup target add ${target}`);
}

// 3. Clean the stale binary so a failed build can't leave a ghost that "works".
if (existsSync(binary)) rmSync(binary);

// 4. Build for the resolved target.
console.log(`[build-rust] building napi engine for ${key} -> ${target}`);
const built = run('napi', ['build', '--cwd', 'src-rust', '--output-dir', '..', '--target', target], {
  stdio: 'inherit',
});
if (built.status !== 0) die(`napi build failed (exit ${built.status}).`);

// 5. Prove it actually loads into THIS node. Catches the ABI/self-register trap
//    at build time instead of at first sandbox boot.
try {
  createRequire(import.meta.url)(binary);
} catch (e) {
  die(
    `Built ${binary} but it will not load into this Node:\n  ${e.message}\n` +
      `This is a Node<->Rust ABI mismatch. Ensure your default toolchain matches the target:\n` +
      `  rustup default stable-${target}`,
  );
}

console.log(`[build-rust] ✓ engine built and verified for ${target}`);
