/**
 * StoreProvider
 * -------------
 * Zustand stores are module singletons — no React context needed.
 * This component performs one-time hydration (autosave restore).
 */
import { useEffect, type ReactNode } from 'react';
import { restoreAutoSave } from '@/features/file-io/services/autoSave';
import { loadFromUrlHash } from '@/features/sharing/services/urlEncoder';

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // URL hash takes precedence over autosave.
    if (!loadFromUrlHash()) {
      restoreAutoSave();
    }
  }, []);
  return <>{children}</>;
}
