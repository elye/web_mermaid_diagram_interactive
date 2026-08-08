/**
 * CanvasControls — zoom in/out, fit-to-view, reset viewport, connectivity mode.
 */
import { Button } from '@/shared/components/Button';
import { useUiStore, type ConnectivityMode } from '@/stores/uiStore';
import { MAX_ZOOM, MIN_ZOOM } from '@/shared/constants/defaults';

const CONNECTIVITY_OPTIONS: { value: ConnectivityMode; label: string; title: string }[] = [
  { value: 'both',         label: '⇄',  title: 'Highlight sources & sinks' },
  { value: 'only-sources', label: '←',  title: 'Highlight sources only (upstream)' },
  { value: 'only-sinks',   label: '→',  title: 'Highlight sinks only (downstream)' },
  { value: 'only-both',    label: '↔',  title: 'Highlight bidirectional connections only' },
  { value: 'none',         label: '○',  title: 'No connectivity highlighting' },
];

export function CanvasControls() {
  const setViewport = useUiStore((s) => s.setViewport);
  const zoom = useUiStore((s) => s.viewport.zoom);
  const connectivityMode = useUiStore((s) => s.connectivityMode);
  const setConnectivityMode = useUiStore((s) => s.setConnectivityMode);
  const showTooltip = useUiStore((s) => s.showTooltip);
  const toggleTooltip = useUiStore((s) => s.toggleTooltip);

  const zoomBy = (factor: number) => {
    setViewport({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor)) });
  };
  const reset = () => setViewport({ zoom: 1, panX: 0, panY: 0 });

  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-2">
      {/* Connectivity mode picker */}
      <div
        className="flex flex-col rounded-md border border-border bg-surface shadow-md overflow-hidden"
        title="Selection connectivity highlight mode"
      >
        <div className="px-2 py-1 text-center text-[10px] font-medium text-muted border-b border-border select-none">
          Focus
        </div>
        {CONNECTIVITY_OPTIONS.map(({ value, label, title }) => (
          <button
            key={value}
            onClick={() => setConnectivityMode(value)}
            title={title}
            aria-pressed={connectivityMode === value}
            className={[
              'px-2 py-1 text-sm font-mono transition-colors',
              connectivityMode === value
                ? 'bg-accent text-white'
                : 'text-ink hover:bg-surface-alt',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tooltip toggle */}
      <div className="flex flex-col rounded-md border border-border bg-surface shadow-md overflow-hidden">
        <button
          onClick={toggleTooltip}
          title={showTooltip ? 'Hide hover tooltips' : 'Show hover tooltips'}
          aria-pressed={showTooltip}
          className={[
            'px-2 py-1 text-sm transition-colors',
            showTooltip
              ? 'bg-accent text-white'
              : 'text-ink hover:bg-surface-alt',
          ].join(' ')}
        >
          💬
        </button>
      </div>

      {/* Zoom controls */}
      <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-1 shadow-md">
        <Button onClick={() => zoomBy(1.2)} aria-label="Zoom in">＋</Button>
        <Button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">－</Button>
        <Button onClick={reset} aria-label="Reset view" title={`Zoom ${Math.round(zoom * 100)}%`}>
          ⟳
        </Button>
      </div>
    </div>
  );
}
