// terminal/plugins/FileIconPlugin.ts
import { ITerminalPlugin, TerminalEventBus } from '../../core/TerminalEventBus';
import { FILE_NAME_MAP, EXTENSION_MAP } from '@cloud-ide/shared/types/constants/iconRegistry';



/**
 * A terminal plugin that acts as a "Sniffer" for file names in the terminal output.
 * * This plugin bridges the gap between the raw text of the terminal canvas and the 
 * interactive React UI. It listens to the standard output stream, parses it for known 
 * file types or extensions, and broadcasts those findings to the Event Bus so that 
 * external React components (like a Context Widget) can render clickable UI elements.
 * * @implements {ITerminalPlugin}
 */

export class FileIconPlugin implements ITerminalPlugin {
  name = 'FileIconPlugin';

  /** * The compiled Regular Expression used to scan terminal output. 
   * @private 
   */
  private regex: RegExp;

  constructor() {
    // Dynamically build a regex from your exact registries
    const exactNames = Object.keys(FILE_NAME_MAP).map(escapeRegex);
    const extensions = Object.keys(EXTENSION_MAP).map(escapeRegex);
    
    // Matches exact files (dockerfile) OR words ending in valid extensions (app.tsx)

    // REGEX BREAKDOWN:
    // 1. (?<!\w)(...) -> Negative Lookbehind: Matches exact files (like '.gitignore' or 'dockerfile') 
    //    ensuring they are not immediately preceded by a word character. This allows 
    //    files starting with a dot to be matched correctly.
    // 2. \b[\w-]+\.(...)\b -> Matches any word ending in a known extension (like 'app.tsx').
    const pattern = `(?<!\\w)(${exactNames.join('|')})\\b|\\b[\\w-]+\\.(${extensions.join('|')})\\b`;
    this.regex = new RegExp(pattern, 'gi');
  }

  /**
   * Initializes the plugin by hooking into the central Terminal Event Bus.
   * * @param {TerminalEventBus} bus - The active event bus instance for the terminal.
   */
  install(bus: TerminalEventBus) {
    // listens for the various files we get on output

    /**
     * Listener 1: Scan Output
     * Every time the terminal backend pushes output to the screen, we scan it.
     */

    bus.on('COMMAND_OUTPUT', ({ output }) => {
       const matches = output.match(this.regex);
       if (matches && matches.length > 0) {
          // Normalize to lowercase and remove duplicates to prevent UI clutter
           const uniqueFiles = Array.from(new Set(matches.map(f => f.toLowerCase())));
           
           // Broadcast to any listening React components (like the Context Widget)
           bus.emit('UI_CONTEXT_SUGGESTED', {
             sourcePlugin: this.name,
             type: 'files',
             items: uniqueFiles
           });
       }
    });

    // Clear the context when a new command starts

    // listens for the various files that have been parsed as input
    /**
     * Listener 2: Cleanup
     * When the user hits Enter to execute a new command, we immediately clear 
     * the context widget so old files from previous commands don't linger on screen.
     */
    bus.on('COMMAND_START', () => {
        bus.emit('UI_CONTEXT_SUGGESTED', {
            sourcePlugin: this.name,
            type: 'files',
            items: [] // Send empty array to clear the UI
        });
    });
  }
}

/**
 * Utility function to escape special regex characters in file names or extensions.
 * For example, this ensures that '.tsx' is parsed as a literal dot followed by tsx, 
 * rather than "any character" followed by tsx.
 * * @param {string} string - The raw string to escape.
 * @returns {string} The safely escaped regex string.
 */
function escapeRegex(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}