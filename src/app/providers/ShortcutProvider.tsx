/**
 * ShortcutProvider
 * ----------------
 * Registers global keyboard shortcuts (undo/redo, save, export, delete).
 */
import { useEffect, type ReactNode } from 'react';
import { registerDefaultShortcuts } from '@/shared/hooks/useKeyboardShortcuts';

export function ShortcutProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    return registerDefaultShortcuts();
  }, []);
  return <>{children}</>;
}
