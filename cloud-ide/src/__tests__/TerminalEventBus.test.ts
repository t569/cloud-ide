// frontend/src/terminal/core/__tests__/TerminalEventBus.test.ts
import { TerminalEventBus } from '../frontend/src/terminal/core/TerminalEventBus';
import { RepoGraphPlugin } from '../frontend/src/terminal/core/plugins/RepoGraphPlugin';

describe('TerminalEventBus & Plugins', () => {
  let bus: TerminalEventBus;

  beforeEach(() => {
    bus = new TerminalEventBus();
    // Use fake timers because our emit() method uses setTimeout(..., 0)
    jest.useFakeTimers(); 
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should trigger the RepoGraphPlugin when git commands are executed', () => {
    // Setup the plugin
    const graphPlugin = new RepoGraphPlugin();
    const consoleSpy = jest.spyOn(console, 'log');
    
    bus.registerPlugin(graphPlugin);

    // Simulate the user hitting enter on a git command
    bus.emit('COMMAND_START', { command: 'git commit -m "init"' });

    // Fast-forward the event loop
    jest.runAllTimers();

    // Verify the plugin intercepted the event and ran its logic
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RepoGraph] Detected structural change')
    );
    
    consoleSpy.mockRestore();
  });

  it('should isolate events so COMMAND_OUTPUT does not trigger COMMAND_START listeners', () => {
    const mockStartListener = jest.fn();
    bus.on('COMMAND_START', mockStartListener);

    // Emit a different event
    bus.emit('COMMAND_OUTPUT', { output: 'file.txt' });
    jest.runAllTimers();

    expect(mockStartListener).not.toHaveBeenCalled();
  });
});