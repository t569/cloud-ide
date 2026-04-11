// terminal/core/plugins/RepoGraphPlugin.ts
import { ITerminalPlugin, TerminalEventBus } from '../../core/TerminalEventBus';

// This is an example plugin: it builds our repo graph by talking to an API
export class RepoGraphPlugin implements ITerminalPlugin {
  name = 'RepoGraphPlugin';

  install(bus: TerminalEventBus) {
    bus.on('COMMAND_START', ({ command }) => {
      if (command.startsWith('git') || command.startsWith('npm install')) {
        console.log(`[RepoGraph] Detected structural change via '${command}'. Rebuilding knowledge graph...`);
        // TODO: Trigger background sync or API call here
      }
    });
  }
}