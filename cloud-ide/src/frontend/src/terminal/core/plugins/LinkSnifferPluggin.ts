// frontend/src/terminal/plugins/LinkSnifferPlugin.ts
import { ITerminalPlugin, TerminalEventBus } from '../../core/TerminalEventBus';

/**
 * Scans terminal output for local development server URLs (localhost/127.0.0.1).
 * Instead of letting the browser try to open a local port (which will fail in a cloud IDE),
 * this plugin broadcasts the detected URLs so the IDE can proxy them to the sandbox ingress.
 */
export class LinkSnifferPlugin implements ITerminalPlugin {
  name = 'LinkSnifferPlugin';
  
  // Matches http://localhost:3000, 127.0.0.1:8080, etc.
  // The (\d{2,5}) capture group isolates the port number!
  private regex = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):(\d{2,5})/gi;

  install(bus: TerminalEventBus) {
    bus.on('COMMAND_OUTPUT', ({ output }) => {
       const matches = output.match(this.regex);
       
       if (matches && matches.length > 0) {
           // Remove duplicates
           const uniqueLinks = Array.from(new Set(matches.map(l => l.toLowerCase())));
           
           bus.emit('UI_CONTEXT_SUGGESTED', {
             sourcePlugin: this.name,
             type: 'links', // Trigger the link rendering path
             items: uniqueLinks
           });
       }
    });

    // Clear the links when the user stops the server or runs a new command
    bus.on('COMMAND_START', () => {
        bus.emit('UI_CONTEXT_SUGGESTED', {
            sourcePlugin: this.name,
            type: 'links',
            items: [] 
        });
    });
  }
}