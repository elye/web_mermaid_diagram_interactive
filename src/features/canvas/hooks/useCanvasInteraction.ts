/**
 * useCanvasInteraction — pan (drag background) and zoom (wheel) on the canvas.
 */
import { useCallback, useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { MAX_ZOOM, MIN_ZOOM } from '@/shared/constants/defaults';

export function useCanvasInteraction(containerRef: React.RefObject<HTMLElement>) {
  const setViewport = useUiStore((s) => s.setViewport);

  const onWheel = useCallback(
    (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) < 1 && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const { viewport } = useUiStore.getState();
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
      setViewport({ zoom: nextZoom });
    },
    [setViewport],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, onWheel]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only pan when starting from the background (not a node, edge, or cluster).
      // Also check `.mf-edge-hit` (hit-area paths use data-hit-edge-id) and
      // `.mf-edge-handle` (drag handles) so clicks on those don't clear selection.
      const target = e.target as Element;
      if (
        target.closest('[data-node-id]') ||
        target.closest('[data-edge-id]') ||
        target.closest('[data-hit-edge-id]') ||
        target.closest('.mf-edge-handle') ||
        target.closest('.mf-edge-handles') ||
        target.closest('g.cluster')
      ) return;

      // Clicking background clears selection.
      useSelectionStore.getState().clear();

      const start = { x: e.clientX, y: e.clientY };
      const { viewport } = useUiStore.getState();
      const startPan = { x: viewport.panX, y: viewport.panY };
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);

      const onMove = (ev: PointerEvent) => {
        setViewport({
          panX: startPan.x + (ev.clientX - start.x),
          panY: startPan.y + (ev.clientY - start.y),
        });
      };
      const onUp = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [setViewport],
  );

  return { onPointerDown };
}
