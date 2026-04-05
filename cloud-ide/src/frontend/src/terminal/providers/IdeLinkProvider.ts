// frontend/src/terminal/providers/IdeLinkProvider.ts
import { Terminal, ILinkProvider, ILink } from '@xterm/xterm';
import { TerminalEventBus } from '../core/TerminalEventBus';
import { FILE_NAME_MAP, EXTENSION_MAP } from '@cloud-ide/shared/types/constants/iconRegistry';

/**
 * A custom link provider for xterm.js that makes specific terminal text natively clickable.
 * * **Architectural Note:** * Unlike the standard WebLinksAddon which blindly opens URLs in a new browser tab, 
 * this provider intercepts clicks on local development URLs (e.g., localhost:3000) 
 * and recognized file names. It then routes those clicks through the central 
 * `TerminalEventBus`, allowing the IDE's React layer to handle the routing 
 * (e.g., opening a file in the editor or launching a split-pane web preview).
 * * @implements {ILinkProvider}
 */
export class IdeLinkProvider implements ILinkProvider {
  /** * The compiled Regular Expression used to scan terminal lines for clickable entities. 
   * @private 
   */
  private regex: RegExp;

  /**
   * @param {Terminal} terminal - The active xterm.js instance used to calculate buffer coordinates.
   * @param {TerminalEventBus} eventBus - The central nervous system for broadcasting click events to the React UI.
   */
  constructor(
    private terminal: Terminal,
    private eventBus: TerminalEventBus
  ) {
    // Combine our File regex and our Localhost regex to create a master scanner
    const exactNames = Object.keys(FILE_NAME_MAP).map(escapeRegex);
    const extensions = Object.keys(EXTENSION_MAP).map(escapeRegex);
    
    // REGEX BREAKDOWN:
    // 1. (?:https?:\/\/(?:localhost|127\.0\.0\.1):\d{2,5}) -> Matches local dev server URLs and ports.
    // 2. (?<!\w)(...) -> Matches exact file names (like .gitignore) without preceding word characters.
    // 3. \b[\w-]+\.(...)\b -> Matches words ending in known file extensions (like app.tsx).
    const pattern = `(?:https?:\\/\\/(?:localhost|127\\.0\\.0\\.1):\\d{2,5})|(?<!\\w)(${exactNames.join('|')})\\b|\\b[\\w-]+\\.(${extensions.join('|')})\\b`;
    this.regex = new RegExp(pattern, 'gi');
  }

  /**
   * Called by the xterm.js engine for every visible line in the terminal buffer.
   * It scans the text and returns an array of coordinates where the engine should 
   * draw hover underlines and listen for mouse clicks.
   * * @param {number} bufferLineNumber - The 1-indexed line number currently being rendered.
   * @param {(links: ILink[] | undefined) => void} callback - The xterm.js callback to register the discovered links.
   */
  public provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    // 1. Get the raw text of the line (subtract 1 because the API is 1-indexed, but the buffer is 0-indexed)
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    // translateToString(true) trims trailing whitespace from the buffer line
    const text = line.translateToString(true);
    const links: ILink[] = [];
    let match;

    // 2. Scan the line sequentially for our regex patterns
    while ((match = this.regex.exec(text)) !== null) {
      const matchedString = match[0];
      const startIndex = match.index;

      // 3. Create the clickable link object with strict X/Y terminal coordinates
      links.push({
        range: {
          start: { x: startIndex + 1, y: bufferLineNumber },
          end: { x: startIndex + matchedString.length, y: bufferLineNumber }
        },
        text: matchedString,
        
        // 4. THE HANDLER: Execute this callback when the user clicks the underlined text
        activate: (event, clickedText) => {
          this.handleActivation(clickedText);
        }
      });
    }

    // Return the generated links to the xterm.js rendering engine
    callback(links);
  }

  /**
   * Determines the classification of the clicked text and broadcasts it to the IDE.
   * * @private
   * @param {string} text - The exact string the user clicked on the terminal canvas.
   */
  private handleActivation(text: string) {
    // Route 1: Development Server URLs
    if (text.includes('http://') || text.includes('127.0.0.1')) {
      this.eventBus.emit('UI_CONTEXT_SUGGESTED', {
        sourcePlugin: 'IdeLinkProvider',
        type: 'links',
        items: [text]
      });
    } 
    // Route 2: Source Code Files
    else {
      this.eventBus.emit('UI_CONTEXT_SUGGESTED', {
        sourcePlugin: 'IdeLinkProvider',
        type: 'files',
        items: [text.toLowerCase()]
      });
    }
  }
}

/**
 * Utility function to escape special regex characters in file names or extensions.
 * * @param {string} string - The raw string to escape.
 * @returns {string} The safely escaped regex string.
 */
function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}