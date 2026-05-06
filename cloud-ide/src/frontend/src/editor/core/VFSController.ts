// frontend/src/editor/core/VFSController.ts
import { EditorEventBus } from './EditorEventBus';

export class VFSController {
  private eventBus: EditorEventBus;
  private dispatch: React.Dispatch<any>; // Passed in from WorkspaceContext

  constructor(eventBus: EditorEventBus, dispatch: React.Dispatch<any>) {
    this.eventBus = eventBus;
    this.dispatch = dispatch;
    this.initListeners();
  }

  private initListeners() {
    // 1. Handle File Opens
    this.eventBus.on('FILE_OPEN_REQUESTED', async ({ path }) => {
      // Tell the UI to create the tab immediately so it feels fast
      this.dispatch({ type: 'OPEN_FILE', payload: { path } });
      this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'syncing' } });

      try {
        // MOCK: Fetch the actual file content from your remote sandbox/local cache
        const content = await this.mockFetchContent(path);
        
        // Broadcast the loaded content so Monaco can inject it into its internal model
        this.eventBus.emit('FILE_LOADED', { path, content, language: this.guessLanguage(path) });
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'synced' } });
      } catch (error) {
        console.error("Failed to load file:", error);
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'conflict' } });
      }
    });

    // 2. Handle File Saves
    this.eventBus.on('SAVE_REQUESTED', async ({ path }) => {
      this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'syncing' } });
      
      try {
        // MOCK: In reality, you'd ask Monaco for the current text buffer here, 
        // then POST it to your sandbox backend.
        await new Promise(resolve => setTimeout(resolve, 800)); // Simulate network latency
        
        this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: false } });
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'synced' } });
      } catch (error) {
        this.dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'conflict' } });
      }
    });

    // 3. Handle General UI State Updates
    this.eventBus.on('TAB_ACTIVATED', ({ path }) => {
      this.dispatch({ type: 'SET_ACTIVE_FILE', payload: { path } });
    });

    this.eventBus.on('TAB_CLOSED', ({ path }) => {
      this.dispatch({ type: 'CLOSE_FILE', payload: { path } });
    });

    this.eventBus.on('CONTENT_CHANGED', ({ path }) => {
      this.dispatch({ type: 'MARK_DIRTY', payload: { path, isDirty: true } });
    });
  }

  // Temporary mock fetcher
  // TODO: Replace this with real API calls to your backend/sandbox to read file contents
  private async mockFetchContent(path: string): Promise<string> {
    return new Promise(resolve => {
      setTimeout(() => {
        if (path.endsWith('.py')) resolve('import os\n\nprint("Hello from VFS!")');
        else if (path.endsWith('.env')) resolve('DISCORD_TOKEN=super_secret');
        else resolve('// Default content');
      }, 300);
    });
  }

  // TODO: make this more robust by using a library like "language-detect" or maintaining a mapping of extensions to languages
  private guessLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': case 'jsx': return 'javascript';
      case 'ts': case 'tsx': return 'typescript';
      case 'py': return 'python';
      default: return 'plaintext';
    }
  }
}