// frontend/src/terminal/core/__tests__/MiddlewarePipeline.test.ts
import { MiddlewarePipeline } from '../frontend/src/terminal/core/MiddlewarePipeline';
import { CommandSnifferMiddleware } from '../frontend/src/terminal/core/middlewares/CommandSnifferMiddleware';
import { TerminalEventBus } from '../frontend/src/terminal/core/TerminalEventBus';

describe('Middleware Integration', () => {
  it('CommandSniffer should build the command buffer and emit on Enter', () => {
    const bus = new TerminalEventBus();
    const emitSpy = jest.spyOn(bus, 'emit');
    
    const pipeline = new MiddlewarePipeline();
    pipeline.use(new CommandSnifferMiddleware(bus));

    // Simulate the xterm.js passing characters to processOutgoing
    pipeline.processOutgoing('l');
    pipeline.processOutgoing('s');
    
    // Nothing should be emitted yet
    expect(emitSpy).not.toHaveBeenCalled();

    // User hits Enter
    pipeline.processOutgoing('\r');

    // Sniffer should have captured "ls" and emitted it
    expect(emitSpy).toHaveBeenCalledWith('COMMAND_START', { command: 'ls' });
  });
});