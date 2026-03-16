import { IMiddleware } from '../MiddlewarePipeline';

export class WindowsClearFix implements IMiddleware {
  public name = 'WindowsClearFix';

  public processIncoming(data: string): string {
    // Matches the ANSI clear sequence OR the word "clear", followed by 20+ empty lines.
    // We use a non-capturing group (?:) for safety.
    const windowsClearBugRegex = /(?:\x1b\[2J\x1b\[[0-9;]*[a-zA-Z]|\bclear\r?\n)(?:\r?\n){20,}/g;

    if (windowsClearBugRegex.test(data)) {
      // Replace the buggy blank lines with a clean ANSI clear screen (\x1b[2J) 
      // and move cursor home (\x1b[H).
      // Crucially, any prompt data (like "~/cloud-ide $ ") appended by the Docker 
      // backend AFTER those newlines remains completely intact.
      return data.replace(windowsClearBugRegex, '\x1b[2J\x1b[H');
    }

    return data;
  }

  public processOutgoing(data: string): string {
    return data;
  }
}