import { useCallback, useEffect, useState } from 'react';

// Light/dark appearance. The choice lives in localStorage (no cookies); without one the device
// preference decides. index.html applies the saved choice before first paint to avoid a flash.
export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'gg-theme';
const THEME_COLOR: Record<Theme, string> = { dark: '#111923', light: '#F3EAD3' };

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function apply(pref: ThemePref, theme: Theme): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme: Theme = pref === 'system' ? system : pref;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => { apply(pref, theme); }, [pref, theme]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch { /* storage unavailable */ }
  }, []);

  return { pref, theme, setPref };
}
