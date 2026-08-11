/**
 * CanvasControls — zoom in/out, fit-to-view, reset viewport, connectivity mode,
 * collapse/expand all, re-route, and zoom-to-fit.
 */
import { useCallback } from 'react';
import { Button } from '@/shared/components/Button';
import { useUiStore, type ConnectivityMode } from '@/stores/uiStore';
import { useDiagramStore } from '@/stores/diagramStore';
import { MAX_ZOOM, MIN_ZOOM } from '@/shared/constants/defaults';
import { computeZoomToFit, getVisibleContentDimensions } from '../services/zoomToFit';
import { computeCollapseState } from '../services/collapseUtils';
import { computeCompactLayout } from '../services/compactLayout';
import { parseSubgraphMembership } from '../services/cluster/subgraphParser';
import type { EdgeWaypoint, EdgeAnchorOverride } from '@/shared/types/diagram';

const CONNECTIVITY_OPTIONS: { value: ConnectivityMode; label: string; title: string }[] = [
  { value: 'both',         label: '\u21c4',  title: 'Highlight sources & sinks' },
  { value: 'only-sources', label: '\u2190',  title: 'Highlight sources only (upstream)' },
  { value: 'only-sinks',   label: '\u2192',  title: 'Highlight sinks only (downstream)' },
  { value: 'only-both',    label: '\u2194',  title: 'Highlight bidirectional connections only' },
  { value: 'none',         label: '\u25cb',  title: 'No connectivity highlighting' },
];

export function CanvasControls() {
  const setViewport = useUiStore((s) => s.setViewport);
  const zoom = useUiStore((s) => s.viewport.zoom);
  const connectivityMode = useUiStore((s) => s.connectivityMode);
  const setConnectivityMode = useUiStore((s) => s.setConnectivityMode);
  const showTooltip = useUiStore((s) => s.showTooltip);
  const toggleTooltip = useUiStore((s) => s.toggleTooltip);

  const collapseAllClusters = useDiagramStore((s) => s.collapseAllClusters);
  const expandAllClusters = useDiagramStore((s) => s.expandAllClusters);

  const zoomBy = (factor: number) => {
    setViewport({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor)) });
  };
  const reset = () => setViewport({ zoom: 1, panX: 0, panY: 0 });

  /**
   * Re-route: recompute an optimal layout for VISIBLE elements only.
   */
  const handleReRoute = useCallback(() => {
    const state = useDiagramStore.getState();
    const { source, collapsedClusters, edges, edgeWaypoints, edgeAnchorOverrides } = state;

    if (collapsedClusters.size === 0) {
      state.clearPositionOverrides();
      state.clearEdgeWaypoints();
      state.clearEdgeAnchorOverrides();
      return;
    }

    const canvas = document.querySelector('.mf-canvas') as HTMLElement | null;
    const svgEl = canvas?.querySelector('svg') as SVGSVGElement | null;
    if (!canvas || !svgEl) return;

    const containerRect = canvas.getBoundingClientRect();
    const viewportAspect = containerRect.width > 0 && containerRect.height > 0
      ? containerRect.width / containerRect.height
      : 16 / 9;

    const membership = parseSubgraphMembership(source);
    const { hiddenNodeIds, hiddenEdgeIds } = computeCollapseState(collapsedClusters, membership, edges);

    const keptEdgeWaypoints: Record<string, EdgeWaypoint[]> = {};
    for (const [id, wp] of Object.entries(edgeWaypoints)) {
      if (hiddenEdgeIds.has(id)) {
        keptEdgeWaypoints[id] = wp;
      }
    }
    const keptEdgeAnchorOverrides: Record<string, { source?: EdgeAnchorOverride; target?: EdgeAnchorOverride }> = {};
    for (const [id, ao] of Object.entries(edgeAnchorOverrides)) {
      if (hiddenEdgeIds.has(id)) {
        keptEdgeAnchorOverrides[id] = ao;
      }
    }

    const compactOverrides = computeCompactLayout(
      svgEl,
      hiddenNodeIds,
      collapsedClusters,
      membership,
      viewportAspect,
    );

    state.hydrate({
      positionOverrides: compactOverrides,
      edgeWaypoints: keptEdgeWaypoints,
      edgeAnchorOverrides: keptEdgeAnchorOverrides,
    });
  }, []);

  /**
   * Zoom-to-fit: measure VISIBLE content bounds (not the full SVG viewBox
   * which includes hidden nodes) and compute optimal zoom/pan.
   */
  const handleZoomToFit = useCallback(() => {
    const canvas = document.querySelector('.mf-canvas') as HTMLElement | null;
    const svgEl = canvas?.querySelector('svg') as SVGSVGElement | null;
    if (!canvas || !svgEl) return;

    const containerRect = canvas.getBoundingClientRect();
    const contentDims = getVisibleContentDimensions(svgEl);

    const viewport = computeZoomToFit({
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
      svgWidth: contentDims.width,
      svgHeight: contentDims.height,
    });

    setViewport(viewport);
  }, [setViewport]);

  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-2">
      {/* Subgraph collapse/expand controls */}
      <div
        className="flex flex-col rounded-md border border-border bg-surface shadow-md overflow-hidden"
        title="Subgraph collapse/expand"
      >
        <div className="px-2 py-1 text-center text-[10px] font-medium text-muted border-b border-border select-none">
          Subgraphs
        </div>
        <button
          onClick={collapseAllClusters}
          title="Collapse all subgraphs"
          className="px-2 py-1 text-sm transition-colors text-ink hover:bg-surface-alt"
        >
          {'\u25b6'} All
        </button>
        <button
          onClick={expandAllClusters}
          title="Expand all subgraphs"
          className="px-2 py-1 text-sm transition-colors text-ink hover:bg-surface-alt"
        >
          {'\u25bc'} All
        </button>
      </div>

      {/* Layout & view controls */}
      <div
        className="flex flex-col rounded-md border border-border bg-surface shadow-md overflow-hidden"
        title="Layout & view"
      >
        <div className="px-2 py-1 text-center text-[10px] font-medium text-muted border-b border-border select-none">
          View
        </div>
        <button
          onClick={handleReRoute}
          title="Re-route: arrange visible elements into a compact grid"
          className="px-2 py-1 text-sm transition-colors text-ink hover:bg-surface-alt"
        >
          {'\u27f2'} Route
        </button>
        <button
          onClick={handleZoomToFit}
          title="Zoom to fit: fit visible content in the viewport"
          className="px-2 py-1 text-sm transition-colors text-ink hover:bg-surface-alt"
        >
          {'\u229e'} Fit
        </button>
      </div>

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
          {'\ud83d\udcac'}
        </button>
      </div>

      {/* Zoom controls */}
      <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-1 shadow-md">
        <Button onClick={() => zoomBy(1.2)} aria-label="Zoom in">{'\uff0b'}</Button>
        <Button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">{'\uff0d'}</Button>
        <Button onClick={reset} aria-label="Reset view" title={`Zoom ${Math.round(zoom * 100)}%`}>
          {'\u27f3'}
        </Button>
      </div>
    </div>
  );
}
