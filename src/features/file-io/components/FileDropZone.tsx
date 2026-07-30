/**
 * FileDropZone — wraps children; drag a `.mmd` or `.mermaidflow` file over
 * the window to load it into the editor.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { loadFromFile } from '../services/fileParser';
import { useUiStore } from '@/stores/uiStore';
import { useHistoryStore } from '@/stores/historyStore';

export function FileDropZone({ children }: { children: ReactNode }) {
  const [hovering, setHovering] = useState(false);
  const pushToast = useUiStore((s) => s.pushToast);
  const commit = useHistoryStore((s) => s.commit);

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setHovering(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      commit();
      const result = await loadFromFile(file);
      if (result.ok) {
        pushToast({ kind: 'success', message: `Loaded ${file.name}` });
      } else {
        pushToast({ kind: 'error', message: result.error });
      }
    },
    [pushToast, commit],
  );

  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setHovering(true);
    };
    const onDragLeave = () => setHovering(false);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onDrop]);

  return (
    <div className="relative flex-1 overflow-hidden">
      {children}
      {hovering && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-accent/10 text-lg font-medium text-accent"
        >
          Drop .mmd or .mermaidflow file to load
        </div>
      )}
    </div>
  );
}
