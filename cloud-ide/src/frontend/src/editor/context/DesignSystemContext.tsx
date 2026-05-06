// frontend/src/editor/context/DesignSystemContext.tsx
import React, { createContext, useContext, useState, useLayoutEffect, useCallback, useMemo } from 'react';
import { IDEGlobalSettings } from '../types/editor';
import { LocalStorageManager } from '../utils/LocalStoragemanager';
import { darkThemePalette, lightThemePalette, toCSSVariables, IDEThemePalette } from '../utils/themeAdapters';

interface DesignSystemState {
  settings: IDEGlobalSettings;
  palette: IDEThemePalette;
  updateSettings: (newSettings: Partial<IDEGlobalSettings>) => void;
}

const DesignSystemContext = createContext<DesignSystemState | null>(null);

export const DesignSystemProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<IDEGlobalSettings>(() => {
    return LocalStorageManager.getGlobalSettings();
  });

  // Dynamically resolve the palette based on the user's setting
  const palette = useMemo(() => {
    return settings.theme === 'dark' ? darkThemePalette : lightThemePalette;
  }, [settings.theme]);

  // Zero-FOUC CSS Injection using the Adapter
  useLayoutEffect(() => {
    const root = document.documentElement;
    
    // Inject Fonts
    root.style.setProperty('--ide-font-family', settings.fontFamily);
    root.style.setProperty('--ide-font-size', `${settings.fontSize}px`);

    // Inject Colors via Adapter
    const cssVars = toCSSVariables(palette);
    Object.entries(cssVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // Toggle Tailwind dark mode class
    if (settings.theme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }, [settings, palette]);

  const updateSettings = useCallback((newSettings: Partial<IDEGlobalSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      LocalStorageManager.saveGlobalSettings(newSettings);
      return updated;
    });
  }, []);

  return (
    <DesignSystemContext.Provider value={{ settings, palette, updateSettings }}>
      {children}
    </DesignSystemContext.Provider>
  );
};

export const useDesignSystem = () => {
  const context = useContext(DesignSystemContext);
  if (!context) throw new Error('useDesignSystem must be used within a DesignSystemProvider');
  return context;
};