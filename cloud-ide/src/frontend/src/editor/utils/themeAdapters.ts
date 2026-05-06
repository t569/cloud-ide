// frontend/src/editor/utils/themeAdapters.ts
import type { ITheme } from '@xterm/xterm';

// ==========================================
// 1. THE CORE PALETTE INTERFACE
// ==========================================
export interface IDEThemePalette {
  name: 'dark' | 'light';
  background: {
    primary: string;   // Main editor / terminal bg
    secondary: string; // Sidebars / tabs
    tertiary: string;  // Button hovers / active states
  };
  text: {
    primary: string;
    muted: string;
  };
  border: string;
  accent: string;
}

// ==========================================
// 2. THE MASTER THEMES
// ==========================================
export const darkThemePalette: IDEThemePalette = {
  name: 'dark',
  background: {
    primary: '#1e1e1e',
    secondary: '#252526',
    tertiary: '#2d2d2d',
  },
  text: {
    primary: '#cccccc',
    muted: '#8a8a8a',
  },
  border: '#333333',
  accent: '#007acc',
};

export const lightThemePalette: IDEThemePalette = {
  name: 'light',
  background: {
    primary: '#ffffff',
    secondary: '#f3f3f3',
    tertiary: '#e8e8e8',
  },
  text: {
    primary: '#333333',
    muted: '#666666',
  },
  border: '#cccccc',
  accent: '#007acc',
};

// ==========================================
// 3. THE ADAPTERS
// ==========================================

/**
 * Translates the palette into CSS Custom Properties for Tailwind
 */
export const toCSSVariables = (palette: IDEThemePalette): Record<string, string> => {
  return {
    '--ide-bg-primary': palette.background.primary,
    '--ide-bg-secondary': palette.background.secondary,
    '--ide-bg-tertiary': palette.background.tertiary,
    '--ide-text-primary': palette.text.primary,
    '--ide-text-muted': palette.text.muted,
    '--ide-border': palette.border,
    '--ide-accent': palette.accent,
  };
};

/**
 * Translates the palette into Xterm.js WebGL colors
 */
export const toXtermTheme = (palette: IDEThemePalette): ITheme => {
  return {
    background: palette.background.primary,
    foreground: palette.text.primary,
    cursor: palette.text.primary,
    cursorAccent: palette.background.primary,
    selectionBackground: palette.background.tertiary,
    // Provide safe fallbacks for ANSI colors based on the theme
    black: palette.name === 'dark' ? '#000000' : '#333333',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: palette.name === 'dark' ? '#e5e5e5' : '#ffffff',
  };
};

/**
 * Translates the palette into Monaco Editor standalone theme data.
 * Note: Monaco types are heavy, so we return 'any' to avoid forcing 
 * the entire app to import monaco-editor just for this utility.
 */
export const toMonacoTheme = (palette: IDEThemePalette): any => {
  return {
    base: palette.name === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { background: palette.background.primary.replace('#', '') }
    ],
    colors: {
      'editor.background': palette.background.primary,
      'editor.foreground': palette.text.primary,
      'editorLineNumber.foreground': palette.text.muted,
      'editor.lineHighlightBackground': palette.background.secondary,
      'editorCursor.foreground': palette.accent,
      'editorIndentGuide.background': palette.border,
    }
  };
};