// frontend/src/editor/types/theme.d.ts

/**
 * 1. THE CORE PALETTE
 * The ultimate source of truth for the Design System.
 */
export interface IDEThemePalette {
  name: 'dark' | 'light';
  background: {
    primary: string;   // Main editor / terminal bg
    secondary: string; // Sidebars / tabs
    hover: string;     // Button hovers
  };
  text: {
    primary: string;
    muted: string;
  };
  accent: string;
  border: string;
}

/**
 * 2. THE ADAPTERS
 * These functions take the Core Palette and translate it for specific engines.
 */
export interface IThemeAdapters {
  // Translates IDEThemePalette to @xterm/xterm ITheme
  toXtermTheme: (palette: IDEThemePalette) => any; 
  
  // Translates IDEThemePalette to monaco.editor.IStandaloneThemeData
  toMonacoTheme: (palette: IDEThemePalette) => any; 
  
  // Translates IDEThemePalette to CSS variables for Tailwind/Vite
  toCSSVariables: (palette: IDEThemePalette) => Record<string, string>;
}