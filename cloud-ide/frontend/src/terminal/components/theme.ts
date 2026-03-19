// frontend/src/terminal/components/theme.ts

// the various themes for our terminal

// TODO: lets fill out the rest of the themes later
import { ITheme } from "@xterm/xterm";


const DEFAULT_THEME: ITheme = {
  background: '#1e1e1e',
  foreground: '#cccccc',
  cursor: '#ffffff',
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

export const THEMES: Record<string, ITheme> = {
  dark: DEFAULT_THEME,
  linux: {
    background: '#000000',
    foreground: '#ffffff',
    // ... other linux-specific colors
  },
  light: {
    background: '#ffffff',
    foreground: '#000000',
    // ... other light-specific colors
  }
};