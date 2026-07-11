// frontend/src/editor/components/ActivityBar.tsx
import React from 'react';
import { ActivityBarItem, SyncStatus } from '../types/editor';

interface ActivityBarProps {
  items: ActivityBarItem[];
  activePanel: string | null;
  onPanelSelect: (panelId: string) => void;
  syncStatus: SyncStatus; // drives the traffic-light indicator
}

// The sync traffic light — a signature element. Each lamp lights (full opacity +
// glow) only for its state, the rest dim to a quiet baseline.
const LAMPS: { state: SyncStatus; color: string }[] = [
  { state: 'conflict', color: '#ff5f56' },
  { state: 'syncing', color: '#ffbd2e' },
  { state: 'synced', color: '#27c93f' },
];

export const ActivityBar = ({ items, activePanel, onPanelSelect, syncStatus }: ActivityBarProps) => {
  const topItems = items.filter((item) => item.position === 'top');
  const bottomItems = items.filter((item) => item.position === 'bottom');

  const renderIcon = (item: ActivityBarItem) => {
    const isActive = activePanel === item.id;
    return (
      <button
        key={item.id}
        title={item.title}
        aria-label={item.title}
        aria-pressed={isActive}
        onClick={() => onPanelSelect(item.id)}
        className="group relative flex h-10 w-12 items-center justify-center"
      >
        {/* Active rail — the VS Code/Zed left marker, now on the accent token. */}
        <span
          className={`absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-ide-accent transition-all duration-150 ${
            isActive ? 'opacity-100' : 'opacity-0'
          }`}
        />
        {/* Icon tile: quiet by default, accent-tinted when active. */}
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            isActive
              ? 'bg-ide-accent/10 text-ide-text'
              : 'text-ide-muted group-hover:bg-ide-hover group-hover:text-ide-text'
          }`}
        >
          {item.icon}
        </span>
      </button>
    );
  };

  return (
    <div className="z-10 flex h-full w-12 flex-shrink-0 select-none flex-col justify-between border-r border-ide-border bg-ide-panel py-2">
      <div className="flex flex-col items-center gap-1">
        <div
          className="mb-1.5 mt-1 flex h-8 w-12 cursor-help items-center justify-center"
          title={`Workspace sync: ${syncStatus}`}
          aria-label={`Workspace sync status: ${syncStatus}`}
        >
          <div className="flex items-center gap-1.5">
            {LAMPS.map(({ state, color }) => {
              const on = syncStatus === state;
              return (
                <span
                  key={state}
                  className="h-2.5 w-2.5 rounded-full transition-all duration-300"
                  style={{
                    backgroundColor: color,
                    opacity: on ? 1 : 0.28,
                    transform: on ? 'scale(1.1)' : 'scale(1)',
                    boxShadow: on ? `0 0 7px ${color}99` : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>

        {topItems.map(renderIcon)}
      </div>

      <div className="flex flex-col items-center gap-1">{bottomItems.map(renderIcon)}</div>
    </div>
  );
};
