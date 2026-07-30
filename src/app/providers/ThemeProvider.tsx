/**
 * ThemeProvider
 * -------------
 * Applies light/dark class on <html> based on uiStore state
 * and system preference on first load.
 */
import { useEffect, type ReactNode } from 'react';
import { useUiStore } from '@/stores/uiStore';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  useEffect(() => {
    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      const apply = () => {
        document.documentElement.classList.toggle('dark', mql.matches);
      };
      apply();
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
    document.documentElement.classList.toggle('dark', theme === 'dark');
    return undefined;
  }, [theme]);

  // Ensure the setter is stable in the tree (no-op consumer).
  void setTheme;
  return <>{children}</>;
}
