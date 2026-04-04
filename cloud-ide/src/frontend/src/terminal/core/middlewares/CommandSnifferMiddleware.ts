// terminal/core/middlewares/CommandSnifferMiddleware.ts
import { IMiddleware } from '../MiddlewarePipeline';
import { TerminalEventBus } from '../TerminalEventBus';

export class CommandSnifferMiddleware implements IMiddleware {
    name = 'CommandSniffer';
    private currentCommand = '';

    constructor(private bus: TerminalEventBus) {}

    processOutgoing(data: string): string {
        // As the user types, build the command string
        if (data === '\r') { // Enter key pressed
            this.bus.emit('COMMAND_START', { command: this.currentCommand.trim() });
            this.currentCommand = '';
        } else if (data === '\x7f') { // Backspace
            this.currentCommand = this.currentCommand.slice(0, -1);
        } else {
            this.currentCommand += data;
        }
        return data;
    }

    processIncoming(data: string): string {
        // Emit output data so plugins can parse it
        this.bus.emit('COMMAND_OUTPUT', { output: data });
        return data;
    }
}