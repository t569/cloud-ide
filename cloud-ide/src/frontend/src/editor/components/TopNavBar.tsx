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

    // 2. Handle specific predefined actions
    if (item.action === 'SAVE_REQUESTED') {
      if (activeFilePath) {
        eventBus.emit('SAVE_REQUESTED', { path: activeFilePath });
      }
      return;
    }

    // 3. Handle custom UI interactions (like "New File")
    if (item.id === 'new-file') {
      const fileName = window.prompt('Enter new file name (e.g., /src/utils.ts):', '/new_file.ts');
      if (fileName) {
        eventBus.emit('FILE_CREATED', { path: fileName, type: 'file' });
      }
      return;
    }

    // Fallback: If an action exists on the item but isn't hardcoded above
    if (item.action) {
      eventBus.emit(item.action, item.payload || {});
    } else {
      console.log(`[TopNavBar] Unhandled menu item clicked: ${item.id}`);
    }
  };

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
        <span>{workspaceName}</span>
      </div>
    </div>
  );
};