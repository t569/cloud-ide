// The one way into the editor. Both /environments (launch a built env) and
// /sandboxes (reopen an existing one) route through here, so the warm-reuse and
// resume semantics of POST /v1/sessions can never be bypassed by one caller.
//
// startSession is keyed on the ENVIRONMENT, not the sandbox: the backend picks this
// user's warm sandbox for that env (resuming it if paused) and cold-boots only when
// there is none. So "open this sandbox" is expressed as "connect me to its env".
import type { EnvironmentConfig } from '@cloud-ide/shared/types/env';
import { startSession, waitForRunning } from '../api/sandbox';
import { toast } from '../notifications';
import { navigate } from './router';
import { stashSession } from './sessionStore';

interface LaunchOptions {
  /** Shown in the editor top bar; falls back to the env id. */
  workspaceName?: string;
  /** Warm-boot context. A cold deep-link just gets { sandboxId }. */
  envConfig?: EnvironmentConfig;
  /** Verb for the pending toast — "Resuming" reads better than "Provisioning". */
  verb?: string;
}

export async function launchEnvironment(
  environmentId: string,
  { workspaceName, envConfig, verb = 'Provisioning' }: LaunchOptions = {},
): Promise<void> {
  const label = workspaceName || environmentId;
  const pending = toast.warning(`${verb} ${label}…`, { duration: 0 });
  try {
    const { sandboxId } = await startSession(environmentId);
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
