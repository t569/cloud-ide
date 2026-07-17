// The built-in plugin: registers the default File/Edit menus and the
// Explorer/Search/Plugins/Settings activity-bar items. This is the first real
// consumer of the ContributionRegistry — proof the extension seam works. Add-on
// plugins (session.plugins) layer on top of these.
import { IEditorPlugin, TopMenuCategory, ActivityBarItem } from '../types/editor';

const MENUS: TopMenuCategory[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { id: 'new-file', label: 'New File', shortcut: 'Ctrl+N' },
      { id: 'open-file', label: 'Open File...', shortcut: 'Ctrl+O' },
      { id: 'div-1', label: '', isDivider: true },
      { id: 'save', label: 'Save', shortcut: 'Ctrl+S', action: 'SAVE_REQUESTED' },
      { id: 'save-all', label: 'Save All', shortcut: 'Ctrl+K S' },
      { id: 'div-2', label: '', isDivider: true },
      // Pause the sandbox and go home; non-destructive, so no confirm dialog.
      { id: 'detach', label: 'Detach', action: 'DETACH_REQUESTED' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Y' },
      { id: 'div-1', label: '', isDivider: true },
      { id: 'cut', label: 'Cut', shortcut: 'Ctrl+X' },
      { id: 'copy', label: 'Copy', shortcut: 'Ctrl+C' },
      { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
    ],
  },
];

const ACTIVITY_ITEMS: ActivityBarItem[] = [
  {
    id: 'explorer',
    title: 'Explorer',
    position: 'top',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 8.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>
    ),
  },
  {
    id: 'search',
    title: 'Search',
    position: 'top',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    ),
  },
  {
    id: 'network',
    title: 'Allowed Hosts',
    position: 'top',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    ),
  },
  {
    id: 'sandbox-access',
    title: 'Sandbox access',
    position: 'top',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="m10.5 12.5 6.5-6.5" />
        <path d="m16 6 2 2" />
        <path d="m18.5 3.5 2 2" />
      </svg>
    ),
  },
  {
    id: 'plugins',
    title: 'Plugins',
    position: 'top',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
      </svg>
    ),
  },
  {
    id: 'settings',
    title: 'Settings',
    position: 'bottom',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

export const coreContributions: IEditorPlugin = {
  name: 'core',
  contribute(reg) {
    MENUS.forEach((m) => reg.registerMenu(m));
    ACTIVITY_ITEMS.forEach((i) => reg.registerActivityItem(i));
  },
};
