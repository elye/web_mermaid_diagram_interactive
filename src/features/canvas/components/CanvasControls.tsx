/**
 * CanvasControls — zoom in/out, fit-to-view, reset viewport.
 */
import { Button } from '@/shared/components/Button';
import { useUiStore } from '@/stores/uiStore';
import { MAX_ZOOM, MIN_ZOOM } from '@/shared/constants/defaults';

export function CanvasControls() {
  const setViewport = useUiStore((s) => s.setViewport);
  const zoom = useUiStore((s) => s.viewport.zoom);

  const zoomBy = (factor: number) => {
    setViewport({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor)) });
  };
  const reset = () => setViewport({ zoom: 1, panX: 0, panY: 0 });

  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1 rounded-md border border-border bg-surface p-1 shadow-md">
      <Button onClick={() => zoomBy(1.2)} aria-label="Zoom in">＋</Button>
      <Button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">－</Button>
      <Button onClick={reset} aria-label="Reset view" title={`Zoom ${Math.round(zoom * 100)}%`}>
        ⟳
      </Button>
    </div>
  );
}
