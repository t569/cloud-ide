// frontend/src/editor/components/TopNavBar.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { TopMenuCategory, MenuItemNode } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';
import { dialog, toast } from '../../notifications';

interface TopNavBarProps {
  menus: TopMenuCategory[];
  activeFilePath: string | null; // <--- We need the full path to know what to save
  workspaceName: string;
  eventBus: EditorEventBus;
}

interface OpenMenu {
  id: string;
  x: number; // viewport-left of the dropdown
  y: number; // viewport-top of the dropdown
}

export const TopNavBar = ({ menus, activeFilePath, workspaceName, eventBus }: TopNavBarProps) => {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position a dropdown flush under its top-level button. Portaled to <body>, so it
  // escapes the navbar's stacking context — the old bug where it rendered *under* the
  // sidebar. Fixed coords come straight from the button's rect.
  const openAt = (menuId: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOpen({ id: menuId, x: r.left, y: r.bottom + 4 });
  };
  const close = useCallback(() => setOpen(null), []);

  // Close on outside click, Escape, or anything that would move the anchor.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (navRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [open, close]);

  // ==========================================
  // ACTION DISPATCHER
  // ==========================================
  const handleItemClick = async (item: MenuItemNode) => {
    if (item.disabled || item.isDivider) return;
    close();

    // SAVE SINGLE FILE
    if (item.id === 'save') {
      if (activeFilePath) eventBus.emit('SAVE_REQUESTED', { path: activeFilePath });
      else toast.info('Open a file first, then save it.', { title: 'Nothing to save' });
      return;
    }

    // SAVE ALL — a blank/ALL path flushes the whole dirty queue in VFSController.
    if (item.id === 'save-all') {
      eventBus.emit('SAVE_REQUESTED', { path: 'ALL' });
      return;
    }

    // NEW FILE
    if (item.id === 'new-file') {
      const name = await dialog.prompt({
        title: 'New file',
        inputLabel: 'Path',
        placeholder: '/src/index.ts',
        defaultValue: '/',
        confirmLabel: 'Create',
      });
      if (name) {
        const safePath = name.startsWith('/') ? name : `/${name}`;
        eventBus.emit('FILE_CREATED', { path: safePath, type: 'file' });
      }
      return;
    }

    // OPEN FILE (native upload into the VFS)
    if (item.id === 'open-file') {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const text = await file.text();
        const newPath = `/${file.name}`;
        eventBus.emit('FILE_CREATED', { path: newPath, type: 'file' });
        // Let the VFS node initialize, then populate + open it.
        setTimeout(() => {
          eventBus.emit('CONTENT_CHANGED', { path: newPath, newContent: text, isDirty: true });
          eventBus.emit('FILE_OPEN_REQUESTED', { path: newPath });
        }, 50);
      };
      input.click();
      return;
    }

    // A wired action fires its bus event; anything else is not built yet — say so
    // instead of silently doing nothing.
    if (item.action) {
      eventBus.emit(item.action, item.payload || {});
    } else {
      toast.info(`${item.label} isn't wired up yet — coming soon.`, { title: 'Not implemented' });
    }
  };

  const displayFileName = activeFilePath ? activeFilePath.split('/').pop() : '';
  const activeMenu = open ? menus.find((m) => m.id === open.id) : null;

  return (
    <div
      ref={navRef}
      className="h-9 w-full bg-ide-panel border-b border-ide-border flex items-center justify-between px-2 select-none relative z-30"
    >
      {/* LEFT: brand + menus */}
      <div className="flex items-center h-full gap-0.5">
        <div className="px-2.5 mr-1 text-ide-accent font-bold text-sm tracking-tight">☁ IDE</div>

        {menus.map((menu) => {
          const isOpen = open?.id === menu.id;
          return (
            <button
              key={menu.id}
              onClick={(e) => (isOpen ? close() : openAt(menu.id, e.currentTarget))}
              onMouseEnter={(e) => open && !isOpen && openAt(menu.id, e.currentTarget)}
              className={`px-3 h-7 text-[13px] rounded-md transition-colors ${
                isOpen ? 'bg-ide-hover text-ide-text' : 'text-ide-muted hover:bg-ide-hover hover:text-ide-text'
              }`}
            >
              {menu.label}
            </button>
          );
        })}
      </div>

      {/* RIGHT: active file + workspace */}
      <div className="text-xs text-ide-muted px-3 flex items-center gap-2 min-w-0">
        {displayFileName && (
          <span className="text-ide-text border-r border-ide-border pr-2 mr-1 truncate max-w-[40vw]">
            {displayFileName}
          </span>
        )}
        <span className="truncate max-w-[20vw]">{workspaceName}</span>
        <button
          onClick={() => eventBus.emit('DISPLAY_TOGGLE_REQUESTED', {})}
          title="Show the sandbox's virtual display — GUI apps (games, plots) render here"
          className="ml-1 px-2.5 h-6 text-[12px] rounded-md border border-ide-border text-ide-muted hover:bg-ide-hover hover:text-ide-text transition-colors shrink-0"
        >
          Display
        </button>
        {/* The restart pair sits together so their different scopes read side-by-side:
            shell = just your terminal; workspace = the whole container. */}
        <button
          onClick={() => eventBus.emit('SHELL_RESTART_REQUESTED', {})}
          title="Kill the active terminal's shell and start a fresh one. Other tabs untouched."
          className="ml-1 px-2.5 h-6 text-[12px] rounded-md border border-ide-border text-ide-muted hover:bg-ide-hover hover:text-ide-text transition-colors shrink-0"
        >
          ⟳ Shell
        </button>
        <button
          onClick={() => eventBus.emit('WORKSPACE_RESTART_REQUESTED', {})}
          title="Replace the container to apply environment changes (rebuilt image, allowed hosts). Files are kept; running processes stop."
          className="px-2.5 h-6 text-[12px] rounded-md border border-ide-border text-ide-muted hover:bg-ide-hover hover:text-ide-text transition-colors shrink-0"
        >
          ⟳ Workspace
        </button>
        <button
          onClick={() => eventBus.emit('DETACH_REQUESTED', {})}
          title="Save everything, pause this workspace, and return home"
          className="px-2.5 h-6 text-[12px] rounded-md border border-ide-border text-ide-muted hover:bg-ide-hover hover:text-ide-text transition-colors shrink-0"
        >
          Detach
        </button>
      </div>

      {/* Dropdown — portaled to <body> so no ancestor stacking context can trap it. */}
      {open &&
        activeMenu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ left: open.x, top: open.y }}
            className="fixed z-[9000] min-w-56 rounded-lg border border-ide-border bg-[#161619] py-1.5 shadow-2xl animate-menu-in"
          >
            {activeMenu.items.map((item, idx) =>
              item.isDivider ? (
                <div key={`div-${idx}`} className="my-1.5 h-px bg-ide-border/70" />
              ) : (
                <button
                  key={item.id}
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => handleItemClick(item)}
                  className={`flex w-full items-center justify-between gap-8 px-3.5 py-1.5 text-left text-[13px] transition-colors ${
                    item.disabled
                      ? 'cursor-not-allowed text-ide-muted opacity-50'
                      : 'text-ide-text hover:bg-ide-accent/15'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.shortcut && (
                    <span className="font-mono text-[11px] tracking-tight text-ide-muted">{item.shortcut}</span>
                  )}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
};
