// frontend/src/terminal/components/theme.ts

import { ITheme } from "@xterm/xterm";

export type BuiltInTheme = 'dark' | 'light' | 'linux';

const DARK_THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
  selectionBackground: '#264f78',
  black: '#000000',
  red: '#cd3131',
  green: '#0dbc79',
  yellow: '#e5e510',
  blue: '#2472c8',
  magenta: '#bc3fbc',
  cyan: '#11a8cd',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f14c4c',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5'
};

const LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#333333',
  cursor: '#000000',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#008000',
  yellow: '#b58900',
  blue: '#0451a5',
  magenta: '#bc3fbc',
  cyan: '#0598bc',
  white: '#ffffff',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b58900',
  brightBlue: '#0451a5',
  brightMagenta: '#bc3fbc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5'
};

const LINUX_THEME: ITheme = {
  background: '#300a24',
  foreground: '#ffffff',
  cursor: '#ffffff',
  selectionBackground: '#5c1f4b',
  black: '#2e3436',
  red: '#cc0000',
  green: '#4e9a06',
  yellow: '#c4a000',
  blue: '#3465a4',
  magenta: '#75507b',
  cyan: '#06989a',
  white: '#d3d7cf',
  brightBlack: '#555753',
  brightRed: '#ef2929',
  brightGreen: '#8ae234',
  brightYellow: '#fce94f',
  brightBlue: '#729fcf',
  brightMagenta: '#ad7fa8',
  brightCyan: '#34e2e2',
  brightWhite: '#eeeeec'
};

export const THEMES: Record<BuiltInTheme, ITheme> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
  linux: LINUX_THEME,
};

export const resolveTheme = (themeProp?: BuiltInTheme | ITheme | string): ITheme => {

  // default to dark theme
  if (!themeProp) return THEMES.dark;
  
  if (typeof themeProp === 'string') {
    return THEMES[themeProp as BuiltInTheme] || THEMES.dark;
  }
  
  return themeProp; 
};