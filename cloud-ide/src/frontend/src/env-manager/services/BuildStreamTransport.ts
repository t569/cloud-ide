// Streams live Docker build logs from POST /api/environment/:envId/build into
// the xterm TerminalComponent. Implements ITransportStream (read-only) so it
// plugs straight into the existing terminal machinery.
import { ITransportStream } from '@frontend/terminal/types/terminal';
import { API_BASE_URL } from '@frontend/config/env';
import { postStream } from '@frontend/lib/apiClient';

export class BuildStreamTransport implements ITransportStream {
  private dataListeners: ((data: string) => void)[] = [];
  private errorListeners: ((error: Error) => void)[] = [];
  private controller: AbortController | null = null;
  private building = false;

  async connect(): Promise<void> {
    /* no persistent connection; the stream opens on startBuild() */
  }

  disconnect(): void {
    this.controller?.abort();
    this.controller = null;
    this.building = false;
    this.dataListeners = [];
    this.errorListeners = [];
  }

  // Read-only stream: keystrokes from the terminal are ignored.
  write(): void {}

  onData(callback: (data: string) => void): void {
    this.dataListeners.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.errorListeners.push(callback);
  }

  get isBuilding(): boolean {
    return this.building;
  }

  private emit(text: string): void {
    // xterm needs CRLF; docker --progress=plain emits bare LF -> normalize to
    // avoid staircase output. ponytail: a chunk split between \r and \n is a rare
    // cosmetic hiccup, not worth buffering across reads.
    const normalized = text.replace(/\r?\n/g, '\r\n');
    this.dataListeners.forEach((cb) => cb(normalized));
  }

  private fail(err: Error): void {
    this.errorListeners.forEach((cb) => cb(err));
  }

  async startBuild(envId: string): Promise<void> {
    if (this.building) return;
    this.building = true;
    this.controller = new AbortController();
    this.emit(`\x1b[1;36m[Cloud IDE]\x1b[0m Requesting build for "${envId}"...\n`);

    try {
      const res = await postStream(`${API_BASE_URL}/environment/${encodeURIComponent(envId)}/build`, {
        signal: this.controller.signal,
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Build request failed (HTTP ${res.status}). ${detail}`.trim());
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.emit(decoder.decode(value, { stream: true }));
      }
      this.emit(`\n\x1b[1;32m[Cloud IDE]\x1b[0m Log stream closed.\n`);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return; // user closed the viewer
      const error = err as Error;
      this.fail(error);
      this.emit(`\n\x1b[1;31m[Cloud IDE]\x1b[0m ${error.message}\n`);
    } finally {
      this.building = false;
    }
  }
}
