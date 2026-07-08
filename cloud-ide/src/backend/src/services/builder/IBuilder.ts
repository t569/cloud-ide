// The swap boundary for image builders. Anything that can turn a Dockerfile +
// tag into a streamed build (Docker today, BuildKit/Kaniko/remote tomorrow)
// implements IBuilder; the rest of the system never spawns `docker` directly.
import { EventEmitter } from 'events';

/**
 * A running build. Emits (deliberately NOT the reserved 'error' event, whose
 * missing-listener throw is a footgun):
 *   'data'      (chunk: string)  — a log chunk
 *   'succeeded' (message: string)
 *   'failed'    (message: string)
 */
export interface BuildProcess extends EventEmitter {
  /** Best-effort abort of the underlying process. */
  cancel(): void;
}

export interface BuildOptions {
  /** Hard build-time limit in ms; the builder aborts and fails past it. */
  timeoutMs?: number;
  /** Target build platform, e.g. 'linux/amd64' | 'linux/arm64' (cross-arch / M-series). */
  platform?: string;
}

export interface IBuilder {
  /** Registry key, e.g. 'docker'. */
  readonly name: string;
  /**
   * Start a build; returns immediately with a streaming handle. The image is
   * tagged with every ref in `imageTags` (e.g. a content-hash tag + :latest).
   */
  build(dockerfile: string, imageTags: string[], opts?: BuildOptions): BuildProcess;
  /** True if an image with this ref already exists locally (cache-hit skip). */
  exists?(imageTag: string): Promise<boolean>;
  /** Point one ref at another (retag) — for :latest updates and rollback. */
  tag?(sourceRef: string, targetRef: string): Promise<void>;
  /**
   * Push a built (registry-qualified) ref to its registry. Optional — a
   * local-only builder omits it. Same data/succeeded/failed streaming contract
   * as build, so its logs ride the same SSE channel.
   */
  push?(imageTag: string): BuildProcess;
}
