// frontend/src/terminal/core/TerminalRegistry.ts

import { ITerminalPlugin } from './TerminalEventBus';
import { ITerminalMiddleware } from '../types/terminal';
import { TerminalEventBus } from './TerminalEventBus';

// Plugins
import { FileIconPlugin } from './plugins/FileIconPlugin';
import { LinkSnifferPlugin } from './plugins/LinkSnifferPluggin';
// import { RepoGraphPlugin } from './plugins/RepoGraphPlugin'; 

// Middlewares
import { WindowsClearFix } from './middlewares/WindowsClearFix';
import { CommandSnifferMiddleware } from './middlewares/CommandSnifferMiddleware';

/**
 * @class TerminalRegistry
 * A centralized factory for instantiating terminal plugins and middlewares.
 * We use factory methods instead of static arrays to ensure every terminal tab 
 * receives its own isolated memory instances of these classes.
 */
export class TerminalRegistry {
  
  /**
   * Returns the default suite of UI and background plugins for a terminal session.
   */
  static getDefaultPlugins(): ITerminalPlugin[] {
    return [
      new FileIconPlugin(),
      new LinkSnifferPlugin(),
      // new RepoGraphPlugin() // <--- Ready to be toggled globally!
    ];
  }

  /**
   * Returns the standard data sanitization and interception pipeline.
   * @param eventBus The isolated event bus for the current terminal panel.
   */
  static getDefaultMiddlewares(eventBus: TerminalEventBus): ITerminalMiddleware[] {
    return [
      new WindowsClearFix(),
      new CommandSnifferMiddleware(eventBus)
    ];
  }
}