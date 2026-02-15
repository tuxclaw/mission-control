import { useState, useEffect, useCallback } from 'react';
import { themes, themeMap, type ThemeId } from '../themes';

const STORAGE_KEY = 'mission-control-theme';

function applyTheme(id: ThemeId): void {
  const theme = themeMap.get(id);
  if (!theme) return;
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.variables)) {
    root.style.setProperty(prop, value);
  }
  root.dataset.theme = id;
}

function loadTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && themeMap.has(stored as ThemeId)) return stored as ThemeId;
  } catch { /* noop */ }
  return 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* noop */ }
  }, []);

  return { theme, setTheme, themes } as const;
}
