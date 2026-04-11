// frontend/src/terminal/dev/MockBuildTransport.ts
import { ITransportStream } from '../types/terminal';

export class MockBuildTransport implements ITransportStream {
  private dataListeners: ((data: string) => void)[] = [];
  private isBuilding = false;

  async connect(): Promise<void> {
    console.log('[MockBuildTransport] Connected to log stream');
  }

  disconnect(): void {
    console.log('[MockBuildTransport] Disconnected');
    this.dataListeners = [];
    this.isBuilding = false;
  }

  onData(callback: (data: string) => void): void {
    this.dataListeners.push(callback);
  }

  onError(callback: (error: Error) => void): void {}

  // A read-only stream shouldn't receive writes from the UI, so we ignore this
  write(data: string): void {
    console.warn('Attempted to write to a read-only stream!');
  }

  // A custom method for our frontend to trigger the mock build
  public startMockBuild() {
    if (this.isBuilding) return;
    this.isBuilding = true;
    
    const logs = [
      '\r\n\x1b[36m[System]\x1b[0m Starting environment provisioning...',
      '\r\nStep 1/5 : FROM ubuntu:22.04',
      '\r\n ---> 216c552ea5ba',
      '\r\nStep 2/5 : RUN apt-get update && apt-get install -y python3',
      '\r\n ---> Running in 8b3b4a2d1e9c',
      '\r\n\x1b[33mWarning: apt-key output should not be parsed (stdout is not a terminal)\x1b[0m',
      '\r\nReading package lists... Done',
      '\r\nStep 3/5 : WORKDIR /workspace',
      '\r\n ---> 9f123a10e081',
      '\r\nStep 4/5 : COPY . .',
      '\r\n ---> 42a1b9c8d7e6',
      '\r\nStep 5/5 : CMD ["bash"]',
      '\r\n ---> 1a2b3c4d5e6f',
      '\r\n\x1b[32mSuccessfully built 1a2b3c4d5e6f\x1b[0m\r\n',
    ];

    let step = 0;
    const interval = setInterval(() => {
      if (step < logs.length) {
        this.dataListeners.forEach(cb => cb(logs[step]));
        step++;
      } else {
        clearInterval(interval);
        this.isBuilding = false;
      }
    }, 600); // Send a new log line every 600ms
  }
}