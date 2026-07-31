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
import { resizeClusters } from '../services/clusterResize';
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
  // re-inject when selection, edge-styles, waypoints, or anchor overrides
  // change (e.g. after undo/redo).
  const edgeDragDeps = `${svg}|${[...selectedEdgeIds].join(',')}|${JSON.stringify(edgeStyles)}|${JSON.stringify(edgeAnchorOverrides)}|${JSON.stringify(edgeWaypoints)}`;

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
    // Resize subgraph cluster rectangles after position overrides are applied.
    resizeClusters(svgEl, useDiagramStore.getState().source);
    expandViewBoxToFit(svgEl);
  }, [positionOverrides, svg, lineStyleMap, waypointMap, anchorOverrideMap]);

  // Apply per-node/edge style overrides.
  //
  // We iterate ALL nodes and edges in the DOM, not just those with overrides,
  // so that when an override is removed (reset) the inline styles are explicitly
  // cleared back to '' — letting Mermaid's default styles take over immediately.
  //
  // Selection is intentionally NEVER expressed by overriding stroke color here
  // — doing so used to hide the user's own preset/custom stroke color (e.g.
  // applying "Error" to a selected node still looked like nothing happened,
  // because the accent color replaced the preset's red border). The selection
  // ring is drawn via the `.mf-node--selected` / `.mf-edge--selected` CSS
  // filter classes instead (see globals.css), which never touches `stroke`.
  //
  // Overrides are applied with `!important`: Mermaid's `classDef`/`class`
  // directive (very common in real-world diagrams) emits its own CSS rules
  // with `!important` (e.g. `.src>* { fill: ... !important; }`), which would
  // otherwise silently beat a plain inline style — the panel would show the
  // new color while the canvas kept rendering the classDef color. `!important`
  // inline styles beat `!important` stylesheet rules, so this makes overrides
  // win regardless of whether the node has a Mermaid class applied.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    // ── Nodes ──
    host.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      const id = g.getAttribute('data-node-id')!;
      const style = nodeStyles[id] ?? {};
      const isSelected = selectedNodeIds.has(id);

      g.querySelectorAll<SVGElement>('rect, polygon, circle, ellipse, path').forEach((shape) => {
        setImportantStyle(shape, 'fill', style.fill ?? '');
        setImportantStyle(shape, 'stroke', style.stroke ?? '');
        // Selection bumps stroke width for extra visual weight, but never
        // touches color — honour the user's own strokeWidth if set.
        setImportantStyle(
          shape,
          'stroke-width',
          style.strokeWidth != null ? `${style.strokeWidth}px` : isSelected ? '2.5px' : '',
        );
      });

      const text = g.querySelector('text, .nodeLabel') as HTMLElement | null;
      if (text) {
        setImportantStyle(text, 'color', style.fontColor ?? '');
        setImportantStyle(text, 'font-size', style.fontSize != null ? `${style.fontSize}px` : '');
      }
    });

    // ── Edges ──
    host.querySelectorAll<SVGPathElement>('path[data-edge-id]').forEach((p) => {
      const id = p.getAttribute('data-edge-id')!;
      const style = edgeStyles[id] ?? {};
      const isSelected = selectedEdgeIds.has(id);

      setImportantStyle(p, 'stroke', style.stroke ?? '');
      setImportantStyle(
        p,
        'stroke-width',
        style.strokeWidth != null ? `${style.strokeWidth}px` : isSelected ? '3px' : '',
      );
      setImportantStyle(p, 'stroke-dasharray', style.dashArray ?? '');
    });
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

/**
 * Set (or clear, when `value` is `''`) an inline style property with
 * `!important` priority. Mermaid's `classDef`/`class` directive emits its
 * own `!important` CSS rules (e.g. `.src>* { fill: ...!important; }`), so a
 * plain (non-important) inline style would silently lose to it. Clearing
 * uses `removeProperty` so Mermaid's own styling (classDef or default) wins
 * again once there's no override.
 */
function setImportantStyle(el: SVGElement | HTMLElement, prop: string, value: string): void {
  if (value) {
    el.style.setProperty(prop, value, 'important');
  } else {
    el.style.removeProperty(prop);
  }
}
