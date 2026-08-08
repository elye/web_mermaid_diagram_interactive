/**
 * useMermaidRender — debounces source changes and updates diagramStore
 * with the latest render result or error.
 */
import { useEffect } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { renderMermaid } from '../services/renderEngine';
import { useDebounce } from '@/shared/hooks/useDebounce';
import { RENDER_DEBOUNCE_MS } from '@/shared/constants/defaults';

export function useMermaidRender() {
  const source = useDiagramStore((s) => s.source);
  const debounced = useDebounce(source, RENDER_DEBOUNCE_MS);

  useEffect(() => {
    let cancelled = false;
    // Clear any previous error as soon as a new render attempt begins.
    useDiagramStore.getState().setRenderError(null);
    (async () => {
      try {
        const result = await renderMermaid(debounced);
        if (cancelled) return;
        useDiagramStore.getState().setRendered(result);
      } catch (err) {
        if (cancelled) return;
        const raw = err instanceof Error ? err.message : String(err);
        // Strip the trailing "mermaid version X.Y.Z" line that mermaid appends.
        const message = raw.replace(/\nmermaid version[\s\S]*$/i, '').trim();
        useDiagramStore.getState().setRenderError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);
}
