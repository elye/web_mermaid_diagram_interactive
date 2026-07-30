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
    (async () => {
      try {
        const result = await renderMermaid(debounced);
        if (cancelled) return;
        useDiagramStore.getState().setRendered(result);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        useDiagramStore.getState().setRenderError(message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);
}
