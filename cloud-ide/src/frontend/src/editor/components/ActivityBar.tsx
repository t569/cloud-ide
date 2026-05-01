// frontend/src/editor/components/ActivityBar.tsx
import React from 'react';
import { ActivityBarItem, SyncStatus } from '../types/editor';

interface ActivityBarProps {
  items: ActivityBarItem[];
  activePanel: string | null;
  onPanelSelect: (panelId: string) => void;
  syncStatus: SyncStatus; // To drive the traffic light system you requested earlier
}

export const ActivityBar = ({ items, activePanel, onPanelSelect, syncStatus }: ActivityBarProps) => {
  const topItems = items.filter(item => item.position === 'top');
  const bottomItems = items.filter(item => item.position === 'bottom');

  const renderIcon = (item: ActivityBarItem) => {
    const isActive = activePanel === item.id;
    return (
      <div
        key={item.id}
        title={item.title}
        onClick={() => onPanelSelect(item.id)}
        className="relative w-12 h-12 flex items-center justify-center cursor-pointer group"
      >
        {/* Active state indicator (Subtle left border highlight like VS Code/Zed) */}
        {isActive && (
          <div className="absolute left-0 top-1/2 transform -translate-y-1/2 w-0.5 h-8 bg-[#007acc] rounded-r" />
        )}
        
        {/* Icon Wrapper */}
        <div className={`
          flex items-center justify-center transition-colors
          ${isActive ? 'text-white' : 'text-[#8a8a8a] group-hover:text-[#cccccc]'}
        `}>
          {item.icon}
        </div>
      </div>
    );
  };

  return (
    <div className="w-12 h-full bg-[#1e1e1e] border-r border-[#2b2d31] flex flex-col justify-between py-2 flex-shrink-0 select-none z-10">
      
      {/* --- TOP SECTION --- */}
      <div className="flex flex-col items-center space-y-2">
        
        {/* MOVED TO TOP: The Traffic Light Sync Status */}
        <div 
          className="w-12 h-8 flex items-center justify-center cursor-help mb-2 mt-1"
          title={`Sync Status: ${syncStatus}`}
        >
          <div className="flex gap-1.5 items-center">
            {/* Red (Conflict / Unsynced) */}
            <div className={`
              w-2.5 h-2.5 rounded-full bg-[#ff5f56] transition-all duration-300
              ${syncStatus === 'conflict' ? 'opacity-100 scale-110 shadow-[0_0_6px_rgba(255,95,86,0.6)]' : 'opacity-30'}
            `} />
            
            {/* Yellow (Syncing in progress) */}
            <div className={`
              w-2.5 h-2.5 rounded-full bg-[#ffbd2e] transition-all duration-300
              ${syncStatus === 'syncing' ? 'opacity-100 scale-110 shadow-[0_0_6px_rgba(255,189,46,0.6)]' : 'opacity-30'}
            `} />
            
            {/* Green (Fully Synced) */}
            <div className={`
              w-2.5 h-2.5 rounded-full bg-[#27c93f] transition-all duration-300
              ${syncStatus === 'synced' ? 'opacity-100 scale-110 shadow-[0_0_6px_rgba(39,201,63,0.6)]' : 'opacity-30'}
            `} />
          </div>
        </div>

        {/* Top Icons (Explorer, Search, Plugins) */}
        {topItems.map(renderIcon)}
      </div>

      {/* --- BOTTOM SECTION --- */}
      <div className="flex flex-col items-center space-y-2">
        {/* Bottom Icons (Settings) */}
        {bottomItems.map(renderIcon)}
      </div>
    </div>
  );
};