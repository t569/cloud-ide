// terminal/plugins/FileIconPlugin.ts
import { ITerminalPlugin, TerminalEventBus } from '../../core/TerminalEventBus';
import { FILE_NAME_MAP, EXTENSION_MAP } from '@cloud-ide/shared/types/constants/iconRegistry';

export class FileIconPlugin implements ITerminalPlugin {
  name = 'FileIconPlugin';
  private regex: RegExp;

  constructor() {
    // Dynamically build a regex from your exact registries
    const exactNames = Object.keys(FILE_NAME_MAP).map(escapeRegex);
    const extensions = Object.keys(EXTENSION_MAP).map(escapeRegex);
    
    // Matches exact files (dockerfile) OR words ending in valid extensions (app.tsx)
    const pattern = `(?<!\\w)(${exactNames.join('|')})\\b|\\b[\\w-]+\\.(${extensions.join('|')})\\b`;
    this.regex = new RegExp(pattern, 'gi');
  }


  install(bus: TerminalEventBus) {
    // listens for the various files we get on output
    bus.on('COMMAND_OUTPUT', ({ output }) => {
       const matches = output.match(this.regex);
       if (matches && matches.length > 0) {
           const uniqueFiles = Array.from(new Set(matches.map(f => f.toLowerCase())));
           
           // Broadcast to any listening React components!
           bus.emit('UI_CONTEXT_SUGGESTED', {
             sourcePlugin: this.name,
             type: 'files',
             items: uniqueFiles
           });
       }
    });

    // Clear the context when a new command starts

    // listens for the various files that have been parsed as input
    bus.on('COMMAND_START', () => {
        bus.emit('UI_CONTEXT_SUGGESTED', {
            sourcePlugin: this.name,
            type: 'files',
            items: [] // Send empty array to clear the UI
        });
    });
  }
}

function escapeRegex(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}