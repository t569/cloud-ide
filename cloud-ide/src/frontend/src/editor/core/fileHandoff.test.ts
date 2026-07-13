// The content handoff, pinned at the level the bug lived: ORDERING.
//
// FILE_LOADED used to be subscribed inside Monaco's onMount, and EditorEventBus drops
// an event that has no listener. Monaco's loader is async (hundreds of ms); the content
// fetch is a localhost round-trip (~10ms). So the fetch always won, the content was
// emitted into the void, and the first file clicked after booting a sandbox opened
// blank -- as did any file opened after the last tab was closed (which disposes both
// the model and, back then, the listener).
//
// MonacoEditorWrapper now buffers FILE_LOADED and seeds from BOTH sides of the join.
// This models that contract without pulling monaco into jsdom: content and editor can
// arrive in either order, and the buffer must render either way.
import { describe, it, expect } from 'vitest';
import { EditorEventBus } from './EditorEventBus';

/** The wrapper's contract, reduced to the part that was broken. */
function makeHandoff(bus: EditorEventBus) {
  const loaded = new Map<string, string>();
  let editor: { value: string } | null = null; // null until monaco's loader finishes
  let activePath: string | null = null;

  const seed = (path: string) => {
    const content = loaded.get(path);
    if (!editor || content === undefined) return; // not both halves yet
    if (activePath !== path) return;              // a background tab: buffered, not shown
    editor.value = content;
  };

  // Subscribed at COMPONENT scope -- before any editor exists. That is the fix.
  bus.on('FILE_LOADED', ({ path, content }) => {
    loaded.set(path, content);
    seed(path);
  });

  return {
    open: (path: string) => { activePath = path; seed(path); },
    mountEditor: () => { editor = { value: '' }; if (activePath) seed(activePath); },
    disposeEditor: () => { editor = null; },
    onScreen: () => editor?.value ?? null,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0)); // the bus emits via setTimeout(0)

describe('file content handoff', () => {
  it('renders when the content beats the editor (THE BUG: fetch ~10ms vs monaco loader ~500ms)', async () => {
    const bus = new EditorEventBus();
    const h = makeHandoff(bus);

    h.open('/workspace/main.py');
    bus.emit('FILE_LOADED', { path: '/workspace/main.py', content: 'print(1)', language: 'python' });
    await flush(); // content has arrived and there is still NO editor

    h.mountEditor(); // monaco finally finishes loading

    expect(h.onScreen()).toBe('print(1)');
  });

  it('renders when the editor beats the content (the case that always worked)', async () => {
    const bus = new EditorEventBus();
    const h = makeHandoff(bus);

    h.mountEditor();
    h.open('/workspace/main.py');
    bus.emit('FILE_LOADED', { path: '/workspace/main.py', content: 'print(1)', language: 'python' });
    await flush();

    expect(h.onScreen()).toBe('print(1)');
  });

  it('re-renders after the last tab closed and disposed the editor', async () => {
    const bus = new EditorEventBus();
    const h = makeHandoff(bus);

    h.mountEditor();
    h.open('/workspace/main.py');
    bus.emit('FILE_LOADED', { path: '/workspace/main.py', content: 'print(1)', language: 'python' });
    await flush();

    h.disposeEditor(); // every tab closed -> <Editor> unmounts, model disposed
    h.open('/workspace/main.py'); // reopened; the VFS re-emits from its cache
    bus.emit('FILE_LOADED', { path: '/workspace/main.py', content: 'print(1)', language: 'python' });
    await flush();
    h.mountEditor();

    expect(h.onScreen()).toBe('print(1)');
  });

  it('a background tab loading last does not seize the editor from the active one', async () => {
    const bus = new EditorEventBus();
    const h = makeHandoff(bus);
    h.mountEditor();

    h.open('/workspace/a.py'); // the tab the user is looking at
    bus.emit('FILE_LOADED', { path: '/workspace/a.py', content: 'AAA', language: 'python' });
    // A restored session opens several tabs at once; b.py's fetch lands LAST.
    bus.emit('FILE_LOADED', { path: '/workspace/b.py', content: 'BBB', language: 'python' });
    await flush();

    expect(h.onScreen()).toBe('AAA');
  });
});
