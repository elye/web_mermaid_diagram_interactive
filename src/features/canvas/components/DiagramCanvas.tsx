/**
 * DiagramCanvas — mounts the rendered SVG, applies viewport transform,
 * wires pan/zoom and node-drag interactions, and applies style overrides
 * & position overrides on each render.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useUiStore } from '@/stores/uiStore';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import { useNodeDrag } from '../hooks/useNodeDrag';
import { useEdgeDrag } from '../hooks/useEdgeDrag';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';
import type { EdgeLineStyle } from '@/shared/types/diagram';

export function DiagramCanvas() {
  useMermaidRender();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);

  const svg = useDiagramStore((s) => s.svg);
  const positionOverrides = useDiagramStore((s) => s.positionOverrides);
  const edgeWaypoints = useDiagramStore((s) => s.edgeWaypoints);
  const edgeAnchorOverrides = useDiagramStore((s) => s.edgeAnchorOverrides);
  const nodeStyles = useStyleStore((s) => s.nodeStyles);
  const edgeStyles = useStyleStore((s) => s.edgeStyles);
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds);
  const viewport = useUiStore((s) => s.viewport);

  // Build Maps for the router (stable across re-renders when contents haven't changed).
  const lineStyleMap = useMemo(() => {
    const m = new Map<string, EdgeLineStyle>();
    Object.entries(edgeStyles).forEach(([id, s]) => {
      if (s.lineStyle) m.set(id, s.lineStyle);
    });
    return m;
  }, [edgeStyles]);

  const waypointMap = useMemo(() => {
    const m = new Map(Object.entries(edgeWaypoints));
    return m;
  }, [edgeWaypoints]);

  const anchorOverrideMap = useMemo(
    () => new Map(Object.entries(edgeAnchorOverrides)),
    [edgeAnchorOverrides],
  );

  // A stable string we can use as a dep for useEdgeDrag so handles
  // re-inject when selection or edge-styles change.
  const edgeDragDeps = `${svg}|${[...selectedEdgeIds].join(',')}|${JSON.stringify(edgeStyles)}|${JSON.stringify(edgeAnchorOverrides)}`;

  const { onPointerDown } = useCanvasInteraction(containerRef);
  useNodeDrag(svgHostRef);
  useEdgeDrag(svgHostRef, edgeDragDeps);

  // Inject SVG into DOM.
  useLayoutEffect(() => {
    if (svgHostRef.current) {
      svgHostRef.current.innerHTML = svg;
    }
  }, [svg]);

  // Apply per-node position overrides after each render, then re-run the
  // edge router so lines follow the overridden positions, then expand the
  // viewBox to fit. This is what makes moved nodes survive Mermaid re-renders
  // (which happen whenever the user types new source).
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const svgEl = host.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    // Never clip a moved node.
    svgEl.style.overflow = 'visible';
    (svgEl.style as CSSStyleDeclaration).maxWidth = 'none';

    // Only apply overrides for node IDs that still exist in the freshly
    // rendered SVG. Stale IDs from a previous source revision are ignored,
    // but kept in the store so undo can restore them.
    Object.entries(positionOverrides).forEach(([id, pos]) => {
      const g = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(id)}"]`);
      if (g) g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    });

    routeAllEdges(svgEl, { lineStyles: lineStyleMap, waypoints: waypointMap, anchorOverrides: anchorOverrideMap });
    expandViewBoxToFit(svgEl);
  }, [positionOverrides, svg, lineStyleMap, waypointMap, anchorOverrideMap]);

  // Apply per-node/edge style overrides.
  // We deliberately apply every property unconditionally (not just when
  // truthy) so that resetting a value to its default actually takes effect.
  // All shape children are updated, not just the first one.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    Object.entries(nodeStyles).forEach(([id, style]) => {
      const g = host.querySelector(`g[data-node-id="${cssEscape(id)}"]`);
      if (!g) return;
      // Apply to ALL shape children so compound shapes (e.g. diamonds with
      // a bounding rect + polygon) both update.
      g.querySelectorAll<SVGElement>('rect, polygon, circle, ellipse, path').forEach((shape) => {
        shape.style.fill = style.fill ?? '';
        shape.style.stroke = style.stroke ?? '';
        shape.style.strokeWidth = style.strokeWidth != null ? `${style.strokeWidth}px` : '';
      });
      const text = g.querySelector('text, .nodeLabel') as SVGElement | HTMLElement | null;
      if (text) {
        (text as HTMLElement).style.color = style.fontColor ?? '';
        (text as HTMLElement).style.fontSize = style.fontSize != null ? `${style.fontSize}px` : '';
      }
    });
    Object.entries(edgeStyles).forEach(([id, style]) => {
      const p = host.querySelector(`path[data-edge-id="${cssEscape(id)}"]`) as SVGElement | null;
      if (!p) return;
      p.style.stroke = style.stroke ?? '';
      p.style.strokeWidth = style.strokeWidth != null ? `${style.strokeWidth}px` : '';
      p.style.strokeDasharray = style.dashArray ?? '';
    });
  // Re-run when selection changes too — selection CSS uses class rules which
  // would be overridden by inline styles only if the inline styles are present.
  // Re-applying here ensures strokeWidth overrides are always in DOM.
  }, [nodeStyles, edgeStyles, svg, selectedNodeIds, selectedEdgeIds]);

  // Wire edge click → selectEdge. Mounted whenever the SVG changes so
  // newly rendered edges are always covered.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const handleEdgeClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Accept clicks on both the visible path and the wide hit-area sibling.
      // The hit path uses data-hit-edge-id; the real path uses data-edge-id.
      if (target?.closest('.mf-edge-handles')) return;
      let id: string | null = null;
      const hitPath = target?.closest('.mf-edge-hit') as SVGPathElement | null;
      if (hitPath) {
        id = hitPath.getAttribute('data-hit-edge-id');
      } else {
        const realPath = target?.closest('path[data-edge-id]') as SVGPathElement | null;
        id = realPath?.getAttribute('data-edge-id') ?? null;
      }
      if (!id) return;
      e.stopPropagation();
      useSelectionStore.getState().selectEdge(id, e.shiftKey);
    };
    host.addEventListener('click', handleEdgeClick);
    return () => host.removeEventListener('click', handleEdgeClick);
  }, [svg]);

  // Reflect selection in DOM.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    host.querySelectorAll('.mf-node--selected').forEach((el) => el.classList.remove('mf-node--selected'));
    selectedNodeIds.forEach((id) => {
      const g = host.querySelector(`g[data-node-id="${cssEscape(id)}"]`);
      g?.classList.add('mf-node--selected');
    });
    // Reflect edge selection.
    host.querySelectorAll('.mf-edge--selected').forEach((el) => el.classList.remove('mf-edge--selected'));
    selectedEdgeIds.forEach((id) => {
      const p = host.querySelector(`path[data-edge-id="${cssEscape(id)}"]`);
      p?.classList.add('mf-edge--selected');
    });
  }, [selectedNodeIds, selectedEdgeIds, svg]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Diagram canvas"
      onPointerDown={onPointerDown}
      className="mf-canvas relative h-full w-full overflow-hidden bg-surface"
      style={{ touchAction: 'none' }}
    >
      {/*
        The transform host is centered inside the viewport but must NOT clip
        its child — we intentionally omit overflow-hidden here so nodes that
        the user drags off the initial layout remain visible.
       */}
      <div
        ref={svgHostRef}
        className="absolute left-1/2 top-1/2 flex items-center justify-center"
        style={{
          transform: `translate(-50%, -50%) translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          transformOrigin: 'center center',
          transition: 'transform 60ms linear',
        }}
      />
    </div>
  );
}

function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
