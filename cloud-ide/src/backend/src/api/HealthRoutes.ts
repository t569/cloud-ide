// GET /api/health — probes every subsystem the gateway depends on, in parallel,
// each with its own timeout, and reports the worst status as the overall one.
//
// 200 when everything is ok or merely degraded; 503 when any subsystem is down
// (so a load balancer pulls the node out of rotation, but a lit-up amber card
// doesn't). A probe that throws or times out is `down`, never a 500 — a health
// endpoint that dies with its dependencies reports nothing.
import { Router } from 'express';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config, IS_PRODUCTION } from '../config/env';
import { DockerCli } from '../services/docker';
import { normalizeLifecycleBaseUrl } from '../services/sandbox/openSandboxEngine';
import { CENTRAL_REPO_PATH, WORKTREES_ROOT } from '../services/sandbox/SandboxManager';
import type { IBuildStore } from '../services/builder';
import type { IEnvironmentRepository, ISandboxRepository } from '../database/interfaces';
import type { ISandboxDriver } from '../services/sandbox/drivers/ISandboxDriver';
import type { HealthCheck, HealthReport, HealthStatus } from '@cloud-ide/shared/types/health';

const PROBE_TIMEOUT_MS = 3_000;
const execFileAsync = promisify(execFile);

/** Resolves with a verdict; throwing (or hanging) means `down`. */
export type Probe = () => Promise<{ status: HealthStatus; detail: string }>;

const ok = (detail: string) => ({ status: 'ok' as const, detail });
const degraded = (detail: string) => ({ status: 'degraded' as const, detail });

// Severity order; the overall status is the worst check.
const SEVERITY: HealthStatus[] = ['ok', 'degraded', 'down'];

export function rollup(checks: HealthCheck[]): HealthStatus {
  return checks.reduce<HealthStatus>(
    (worst, c) => (SEVERITY.indexOf(c.status) > SEVERITY.indexOf(worst) ? c.status : worst),
    'ok',
  );
}

async function runProbe(name: string, probe: Probe, timeoutMs: number): Promise<HealthCheck> {
  const startedAt = Date.now();
  const timeout = new Promise<never>((_, reject) => {
    // unref: a fast probe must not hold the event loop open for the full timeout.
    setTimeout(() => reject(new Error(`probe timed out after ${timeoutMs}ms`)), timeoutMs).unref?.();
  });

  try {
    const verdict = await Promise.race([probe(), timeout]);
    return { name, ...verdict, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return { name, status: 'down', detail: (err as Error).message, latencyMs: Date.now() - startedAt };
  }
}

export async function runProbes(
  probes: Record<string, Probe>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<HealthReport> {
  const checks = await Promise.all(
    Object.entries(probes).map(([name, probe]) => runProbe(name, probe, timeoutMs)),
  );
  return {
    status: rollup(checks),
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  };
}

export interface HealthDeps {
  sandboxRepo: ISandboxRepository;
  envRepo: IEnvironmentRepository;
  buildStore: IBuildStore;
  driver: ISandboxDriver;
}

export function systemProbes(deps: HealthDeps): Record<string, Probe> {
  const docker = new DockerCli();

  return {
    // Boot-time configuration preflight. Distinct from PreFlightChecks (which
    // guards a single sandbox's git worktree at delete time) — this one asks
    // whether the process is configured safely enough to be serving at all.
    preflight: async () => {
      if (IS_PRODUCTION && !config.AUTH_SECRET) {
        return { status: 'down' as const, detail: 'AUTH_SECRET unset in production — identity cookies are forgeable' };
      }
      const notes = [
        `driver=${config.SANDBOX_DRIVER}`,
        `env=${config.NODE_ENV}`,
        `admin=${config.ADMIN_TOKEN ? 'enabled' : 'disabled'}`,
      ].join(', ');
      return config.FRONTEND_ORIGIN === '*'
        ? degraded(`FRONTEND_ORIGIN=* is incompatible with credentialed CORS; ${notes}`)
        : ok(notes);
    },

    opensandbox: async () => {
      const base = normalizeLifecycleBaseUrl(config.OPENSANDBOX_API_URL);
      const headers = config.OPENSANDBOX_API_KEY
        ? { 'OPEN-SANDBOX-API-KEY': config.OPENSANDBOX_API_KEY }
        : undefined;
      // Node's fetch rejects with a bare "fetch failed" and hides the real reason
      // (ECONNREFUSED, ENOTFOUND, timeout) in `.cause` — surface it, or the card
      // reads "fetch failed" and tells the operator nothing.
      const res = await fetch(`${base}/sandboxes`, {
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }).catch((err: Error & { cause?: { code?: string } }) => {
        // ponytail: cast, not a tsconfig `lib` bump — Error.cause is es2022 and this
        // is the only place in the backend that reads it.
        throw new Error(`${base} unreachable: ${err.cause?.code ?? err.message}`);
      });
      // ponytail: any answer below 500 proves the daemon is listening and routing —
      // we deliberately don't assert this route exists. Only a connection failure
      // (fetch throws) or a 5xx is a real fault.
      return res.status < 500
        ? ok(`${base} reachable (HTTP ${res.status})`)
        : degraded(`${base} returned HTTP ${res.status}`);
    },

    docker: async () => {
      // `version` reaches the daemon (unlike `--version`) and exits non-zero when
      // it can't — DockerCli.run() rejects, which runProbe turns into `down`.
      const { stdout } = await docker.run(['version', '--format', '{{.Server.Version}}']);
      return ok(`daemon ${stdout.trim() || 'reachable'}`);
    },

    'build-store': async () => {
      await deps.buildStore.ready; // volatile stores expose none; awaiting undefined is fine
      const all = deps.buildStore.all();
      const active = all.filter((b) => b.status === 'queued' || b.status === 'building').length;
      const backend = (process.env.BUILD_STORE ?? 'json').toLowerCase();
      return ok(`${backend}, ${all.length} envs tracked, ${active} building`);
    },

    persistence: async () => {
      const envs = await deps.envRepo.list();
      return ok(`json repos readable, ${envs.length} environments`);
    },

    sandboxes: async () => {
      const all = await deps.sandboxRepo.list();
      const census = new Map<string, number>();
      for (const s of all) census.set(s.state, (census.get(s.state) ?? 0) + 1);
      const detail =
        all.length === 0
          ? 'none provisioned'
          : [...census].map(([state, n]) => `${n} ${state.toLowerCase()}`).join(', ');
      // A sandbox stuck in ERROR is a user-visible fault, but the plane still serves.
      return (census.get('ERROR') ?? 0) > 0 ? degraded(detail) : ok(detail);
    },

    // The VFS is host-direct node:fs over the worktrees root, so the subsystem that
    // can actually fail is the storage under it: the directory, the `git` binary
    // WorktreeEngine shells out to, and the bare repo worktrees branch from.
    // FsEventHub and WorkspaceWatchers are an in-process EventEmitter and a ref-count
    // Map — they cannot be down while this handler is answering, so they aren't probed.
    vfs: async () => {
      // A fresh install has no worktrees root until the first provision creates it;
      // until then the writability question belongs to its parent (`data/`).
      const created = existsSync(WORKTREES_ROOT);
      const target = created ? WORKTREES_ROOT : path.dirname(WORKTREES_ROOT);

      // ponytail: W_OK catches a missing dir, a bad cwd and a read-only mount —
      // not a full disk. Swap in a write-then-unlink probe if disk-full ever bites.
      await fs.access(target, fs.constants.W_OK).catch(() => {
        throw new Error(`worktrees root not writable: ${target}`);
      });

      // git is not optional: no binary, no worktree, no workspace for any sandbox.
      const git = await execFileAsync('git', ['--version']).catch(() => {
        throw new Error('git binary not found on PATH — worktrees cannot be created');
      });

      const worktrees = created ? (await fs.readdir(WORKTREES_ROOT)).length : 0;
      // The bare repo is bootstrapped lazily on first provision, so its absence on a
      // fresh install is normal — reporting it as a fault would cry wolf.
      const baseRepo = existsSync(CENTRAL_REPO_PATH) ? 'initialized' : 'pending first provision';
      return ok(`${worktrees} worktrees, base repo ${baseRepo}, ${git.stdout.trim()}`);
    },

    'sandbox-driver': async () => {
      const caps = deps.driver.capabilities();
      const detail = `${config.SANDBOX_DRIVER}: exec=${caps.exec}, pty=${caps.pty}`;
      // pty=false is the default driver's advertised shape, not a fault — reporting
      // it as degraded would leave a healthy install permanently amber. Losing exec,
      // though, means no builds, no terminal, no file sync.
      return caps.exec ? ok(detail) : degraded(`${detail} — driver cannot execute commands`);
    },
  };
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const report = await runProbes(systemProbes(deps));
    res.status(report.status === 'down' ? 503 : 200).json(report);
  });
  return router;
}
