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

export interface IBuilder {
  /** Registry key, e.g. 'docker'. */
  readonly name: string;
  /**
   * Start a build; returns immediately with a streaming handle. The image is
   * tagged with every ref in `imageTags` (e.g. a content-hash tag + :latest).
   */
  build(dockerfile: string, imageTags: string[]): BuildProcess;
}
