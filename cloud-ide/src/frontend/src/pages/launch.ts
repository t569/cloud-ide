// The one way into the editor. Both /environments (launch an env) and /sandboxes
// (reopen a workspace) route through here, so the reuse/resume/recover semantics of
// POST /v1/sessions can never be bypassed by one caller.
//
// A workspace is a sandbox record (an owner + a git worktree); the environment is only
// the image it booted from. Reopening therefore names the SANDBOX. It used to name the
// env — and the backend then matched the first record for that env, so with two
// workspaces on one image, Open on B handed you A.
import type { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { startSession, waitForRunning } from '../api/sandbox';
import { toast } from '../notifications';
import { navigate } from './router';
import { stashSession } from './sessionStore';

interface LaunchOptions {
  /** Shown in the editor top bar; falls back to the id. */
  workspaceName?: string;
  /** Warm-boot context. A cold deep-link just gets { sandboxId }. */
  envConfig?: EnvironmentConfig;
  /** Verb for the pending toast — "Resuming" reads better than "Provisioning". */
  verb?: string;
}

/** Open a workspace by id: exactly this one, whatever env it came from. */
export function openWorkspace(sandboxId: string, opts: LaunchOptions = {}): Promise<void> {
  return launch({ sandboxId }, opts.workspaceName || sandboxId, opts);
}

/**
 * Open this user's workspace for an environment, cold-booting one if they have none.
 * `fresh` forces an ADDITIONAL workspace on the same env instead of reusing.
 */
export function launchEnvironment(
  environmentId: string,
  opts: LaunchOptions & { fresh?: boolean } = {},
): Promise<void> {
  return launch(
    { environmentId, fresh: opts.fresh },
    opts.workspaceName || environmentId,
    opts,
  );
}

async function launch(
  target: { sandboxId?: string; environmentId?: string; fresh?: boolean },
  label: string,
  { envConfig, verb = 'Provisioning' }: LaunchOptions,
): Promise<void> {
  const pending = toast.warning(`${verb} ${label}…`, { duration: 0 });
  try {
    // The id we get back may not be the one we asked for: a container that can't be
    // revived is replaced onto the same worktree and comes back with a new id. Follow it.
    const { sandboxId } = await startSession(target);
    // The VFS needs a live workspace to hydrate. Cheap on a warm reuse — returns on
    // the first poll; a resume costs a poll or two.
    await waitForRunning(sandboxId);
    stashSession({ sandboxId, workspaceName: label, envConfig });
    toast.dismiss(pending);
    navigate(`/editor/${encodeURIComponent(sandboxId)}`);
  } catch (e) {
    toast.dismiss(pending);
    toast.error(`Failed to open ${label}: ${(e as Error).message}`);
  }
}
