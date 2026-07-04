// frontend/src/editor/components/TopNavBar.tsx
import React, { useState, useRef, useEffect } from 'react';
import { TopMenuCategory, MenuItemNode } from '../types/editor';
import { EditorEventBus } from '../core/EditorEventBus';

interface TopNavBarProps {
  menus: TopMenuCategory[];
  activeFilePath: string | null; // <--- We need the full path to know what to save
  workspaceName: string;
  eventBus: EditorEventBus;
}

export const TopNavBar = ({ menus, activeFilePath, workspaceName, eventBus }: TopNavBarProps) => {
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Close the menu if the user clicks outside of the navbar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ==========================================
  // ACTION DISPATCHER
  // ==========================================
  const handleItemClick = (item: MenuItemNode) => {
    if (item.disabled || item.isDivider) return;

    // 1. Close the menu
    setActiveMenuId(null);

    // 2. SAVE SINGLE FILE
    if (item.id === 'save') {
      if (activeFilePath) {
        eventBus.emit('SAVE_REQUESTED', { path: activeFilePath });
      } else {
        console.warn("[TopNavBar] No active file to save.");
      }
      return;
    }

    // 3. SAVE ALL
    if (item.id === 'save-all') {
      // Sending a blank/ALL path signals the VFSController to flush the entire dirty queue
      eventBus.emit('SAVE_REQUESTED', { path: 'ALL' }); 
      return;
    }

    // 4. NEW FILE
    if (item.id === 'new-file') {
      const fileName = window.prompt('Enter new file name (e.g., /jack/robinson.asm):', '/new_file.txt');
      if (fileName) {
        // Ensure path starts with /
        const safePath = fileName.startsWith('/') ? fileName : `/${fileName}`;
        eventBus.emit('FILE_CREATED', { path: safePath, type: 'file' });
      }
      return;
    }

    // 5. OPEN FILE (Native Upload to VFS)
    if (item.id === 'open-file') {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const text = await file.text();
          const newPath = `/${file.name}`;
          
          // Inject it into the VFS!
          eventBus.emit('FILE_CREATED', { path: newPath, type: 'file' });
          
          // Wait a tiny fraction of a second for the VFS node to initialize, then populate it
          setTimeout(() => {
            eventBus.emit('CONTENT_CHANGED', { path: newPath, newContent: text, isDirty: true });
            eventBus.emit('FILE_OPEN_REQUESTED', { path: newPath });
          }, 50);
        }
      };
      input.click(); // Trigger the browser's native file picker
      return;
    }

    // Fallback: If an action exists on the item but isn't hardcoded above
    if (item.action) {
      eventBus.emit(item.action, item.payload || {});
    } else {
      console.log(`[TopNavBar] Unhandled menu item clicked: ${item.id}`);
    }
  };

  // Extract just the filename for UI display (e.g., "/jack/robinson.asm" -> "robinson.asm")
  const displayFileName = activeFilePath ? activeFilePath.split('/').pop() : '';

  return (
    <div 
      ref={navRef}
      className="h-9 w-full bg-ide-panel border-b border-ide-border flex items-center justify-between px-2 select-none z-50 relative"
    >
      {/* LEFT: Menu Items */}
      <div className="flex items-center h-full gap-1">
        {/* App Logo / Icon */}
        <div className="px-2 text-ide-accent font-bold text-sm">
          ☁️ IDE
        </div>

        {menus.map((menu) => (
          <div key={menu.id} className="relative h-full flex items-center">
            {/* The Top-Level Button (e.g., "File", "Edit") */}
            <button
              onClick={() => setActiveMenuId(activeMenuId === menu.id ? null : menu.id)}
              onMouseEnter={() => {
                // If a menu is already open, hovering over another menu instantly opens it
                if (activeMenuId && activeMenuId !== menu.id) {
                  setActiveMenuId(menu.id);
                }
              }}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeMenuId === menu.id 
                  ? 'bg-ide-hover text-ide-text' 
                  : 'text-ide-muted hover:bg-ide-hover hover:text-ide-text'
              }`}
            >
              {menu.label}
            </button>

            {/* The Dropdown Menu Widget */}
            {activeMenuId === menu.id && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-ide-panel border border-ide-border shadow-lg rounded-md py-1 z-50">
                {menu.items.map((item, idx) => {
                  
                  if (item.isDivider) {
                    return <div key={`div-${idx}`} className="h-px bg-ide-border my-1 mx-2" />;
                  }

                  return (
                    <button
                      key={item.id}
                      disabled={item.disabled}
                      onClick={() => handleItemClick(item)}
                      className={`w-full text-left px-4 py-1.5 text-sm flex items-center justify-between transition-colors
                        ${item.disabled 
                          ? 'text-ide-muted opacity-50 cursor-not-allowed' 
                          : 'text-ide-text hover:bg-ide-hover hover:text-white'
                        }
                      `}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="text-xs text-ide-muted tracking-widest">{item.shortcut}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* RIGHT: Workspace Name / Status */}
      <div className="text-xs text-ide-muted px-4 font-ide flex items-center gap-2">
        {displayFileName && <span className="text-ide-text border-r border-ide-border pr-2 mr-2">{displayFileName}</span>}
        <span>{workspaceName}</span>
      </div>
    </div>
  );
};