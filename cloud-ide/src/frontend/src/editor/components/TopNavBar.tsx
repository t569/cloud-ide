// frontend/src/editor/components/TopNavBar.tsx
import React, { useState, useEffect, useRef } from 'react';
import { TopMenuCategory, EditorEventPayloads, MenuItemNode } from '../types/editor';

interface TopNavBarProps {
  menus: TopMenuCategory[];
  activeFileName?: string;
  workspaceName?: string;
  eventBus: {
    emit: <K extends keyof EditorEventPayloads>(event: K, payload?: any) => void;
  };
}

export const TopNavBar = ({ menus, activeFileName, workspaceName = 'Cloud IDE', eventBus }: TopNavBarProps) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Close dropdown if user clicks anywhere outside the nav bar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAction = (item: MenuItemNode) => {
    if (item.action) {
      eventBus.emit(item.action, item.payload);
    }
    setActiveMenu(null);
  };

  return (
    <div 
      ref={navRef}
      className="h-10 bg-[#1e1e1e] flex items-center justify-between px-3 select-none text-[13px] border-b border-[#2b2d31]"
    >
      {/* --- LEFT: App Icon & Menus --- */}
      <div className="flex h-full items-center gap-2">
        {/* Diamond App Icon */}
        <div className="text-blue-500 mr-2 flex items-center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 12l10 10 10-10L12 2zm0 2.83L19.17 12 12 19.17 4.83 12 12 4.83z" />
          </svg>
        </div>

        {/* Dynamic Menu Generator */}
        {menus.map((menu) => (
          <div key={menu.id} className="relative h-full flex items-center">
            <div
              className={`px-2 py-1 rounded cursor-pointer hover:bg-[#313338] transition-colors ${activeMenu === menu.id ? 'bg-[#313338] text-white' : 'text-[#cccccc]'}`}
              onClick={() => setActiveMenu(activeMenu === menu.id ? null : menu.id)}
              onMouseEnter={() => {
                if (activeMenu) setActiveMenu(menu.id); // Fast-switch menus on hover if one is already open
              }}
            >
              {menu.label}
            </div>

            {/* Dropdown Menu Panel */}
            {activeMenu === menu.id && (
              <div className="absolute top-[100%] left-0 mt-1 w-64 bg-[#252526] border border-[#333333] rounded shadow-lg py-1 z-50">
                {menu.items.map((item, idx) => (
                  item.isDivider ? (
                    <div key={`div-${idx}`} className="h-[1px] bg-[#333333] my-1 mx-2" />
                  ) : (
                    <div
                      key={item.id}
                      onClick={() => !item.disabled && handleAction(item)}
                      className={`flex justify-between items-center px-4 py-1.5 cursor-pointer 
                        ${item.disabled ? 'text-gray-500 cursor-not-allowed' : 'text-[#cccccc] hover:bg-[#0060c0] hover:text-white'}`}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span className="text-xs opacity-60 ml-4 tracking-widest">{item.shortcut}</span>}
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* --- CENTER: Contextual Window Title --- */}
      <div className="absolute left-1/2 transform -translate-x-1/2 text-gray-400 text-xs text-center flex-1 pointer-events-none">
        {activeFileName ? `${activeFileName} - ${workspaceName}` : workspaceName}
      </div>

      {/* --- RIGHT: Window Controls --- */}
      <div className="flex h-full items-center text-gray-400 space-x-1">
        {/* Minimize */}
        <div className="w-10 h-full flex items-center justify-center hover:bg-[#313338] hover:text-white cursor-pointer transition-colors">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><rect y="7" width="16" height="2"/></svg>
        </div>
        {/* Maximize */}
        <div className="w-10 h-full flex items-center justify-center hover:bg-[#313338] hover:text-white cursor-pointer transition-colors">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" fillRule="evenodd" clipRule="evenodd"><path d="M14 2v12H2V2h12zm-1 1H3v10h10V3z"/></svg>
        </div>
        {/* Close */}
        <div className="w-10 h-full flex items-center justify-center hover:bg-red-500 hover:text-white cursor-pointer transition-colors">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" clipRule="evenodd" d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.646 3.646.707.708L8 8.707z"/></svg>
        </div>
      </div>
    </div>
  );
};