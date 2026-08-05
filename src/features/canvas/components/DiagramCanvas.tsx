/**
 * DiagramCanvas — mounts the rendered SVG, applies viewport transform,
 * wires pan/zoom and node-drag interactions, and applies style overrides
 * & position overrides on each render.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUiStore } from '@/stores/uiStore';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import { useNodeDrag } from '../hooks/useNodeDrag';
import { useEdgeDrag } from '../hooks/useEdgeDrag';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';
import { resizeClusters } from '../services/clusterResize';
import { parseSubgraphMembership } from '../services/cluster/subgraphParser';
import type { EdgeLineStyle } from '@/shared/types/diagram';

export function DiagramCanvas() {
  useMermaidRender();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  // Each node's natural (Mermaid-computed) transform, captured right after
  // the SVG is injected and before any position override is applied. See
  // the SVG-injection effect below for why this is needed.
  const naturalPositionsRef = useRef<Map<string, string>>(new Map());

  const svg = useDiagramStore((s) => s.svg);
  const positionOverrides = useDiagramStore((s) => s.positionOverrides);
  const edgeWaypoints = useDiagramStore((s) => s.edgeWaypoints);
  const edgeAnchorOverrides = useDiagramStore((s) => s.edgeAnchorOverrides);
  const nodeStyles = useStyleStore((s) => s.nodeStyles);
  const edgeStyles = useStyleStore((s) => s.edgeStyles);
  const clusterStyles = useStyleStore((s) => s.clusterStyles);
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds);
  const selectedClusterId = useSelectionStore((s) => s.selectedClusterId);
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

  // Inject SVG into DOM, then snapshot each node's natural (Mermaid-computed)
  // transform before any position overrides are applied. This snapshot is
  // what lets us restore a node's original spot below when an override is
  // removed entirely (e.g. undoing a node's very first move) — without it,
  // the node's transform attribute would just keep whatever value we last
  // wrote and never revert, even though the store correctly has no override.
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    host.innerHTML = svg;
    const naturalPositions = new Map<string, string>();
    host.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      const id = g.getAttribute('data-node-id');
      const transform = g.getAttribute('transform');
      if (id && transform) naturalPositions.set(id, transform);
    });
    naturalPositionsRef.current = naturalPositions;
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

    // For every node in the freshly rendered SVG: apply its override if one
    // exists, otherwise restore its natural (pre-override) position. Without
    // the "else" branch, undoing a node's only override left the DOM stuck
    // showing the last-overridden position forever, even though the store
    // correctly went back to having no override for that node.
    svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      const id = g.getAttribute('data-node-id');
      if (!id) return;
      const pos = positionOverrides[id];
      if (pos) {
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      } else {
        const natural = naturalPositionsRef.current.get(id);
        if (natural) g.setAttribute('transform', natural);
      }
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

    // ── Clusters ──
    host.querySelectorAll<SVGGElement>('g.cluster').forEach((g) => {
      const id = extractClusterUserId(g.getAttribute('id') ?? '');
      if (!id) return;
      const style = clusterStyles[id] ?? {};

      const rect = g.querySelector('rect') as SVGRectElement | null;
      if (rect) {
        setImportantStyle(rect, 'fill', style.fill ?? '');
        setImportantStyle(rect, 'stroke', style.stroke ?? '');
        setImportantStyle(
          rect,
          'stroke-width',
          style.strokeWidth != null ? `${style.strokeWidth}px` : '',
        );
      }
    });
  }, [nodeStyles, edgeStyles, clusterStyles, svg, selectedNodeIds, selectedEdgeIds]);

  // Wire cluster pointerdown → drag and touchable selection.
  // Mounted whenever the SVG changes so newly rendered clusters are always covered.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    // Get the SVG element
    const svgEl = host.querySelector('svg');
    if (!svgEl) return;

    let clusterDragCtx: {
      clusterId: string;
      clusterGroup: SVGGElement;
      nodeIds: string[];
      nodeOriginalPositions: Map<string, { x: number; y: number }>;
      startX: number;
      startY: number;
      moved: boolean;
    } | null = null;

    // Define move and up handlers first so they can be referenced in down handler
    const handleClusterPointerMove = (e: PointerEvent) => {
      if (!clusterDragCtx) return;

      const zoom = useUiStore.getState().viewport.zoom || 1;
      const dx = (e.clientX - clusterDragCtx.startX) / zoom;
      const dy = (e.clientY - clusterDragCtx.startY) / zoom;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) clusterDragCtx.moved = true;

      const svg = clusterDragCtx.clusterGroup.ownerSVGElement;
      if (!svg) return;

      // Move all nodes in the cluster
      clusterDragCtx.nodeIds.forEach((nodeId) => {
        const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
        if (!g) return;
        const orig = clusterDragCtx!.nodeOriginalPositions.get(nodeId);
        if (orig) {
          g.setAttribute('transform', `translate(${orig.x + dx}, ${orig.y + dy})`);
        }
      });

      // Re-route edges and resize clusters
      const { edgeWaypoints, edgeAnchorOverrides, source } = useDiagramStore.getState();
      const edgeStyles = useStyleStore.getState().edgeStyles;
      const lineStyles = new Map(
        Object.entries(edgeStyles)
          .filter(([, s]) => s.lineStyle)
          .map(([id, s]) => [id, s.lineStyle!] as const),
      );
      routeAllEdges(svg, {
        lineStyles,
        waypoints: new Map(Object.entries(edgeWaypoints)),
        anchorOverrides: new Map(Object.entries(edgeAnchorOverrides)),
      });
      resizeClusters(svg, source);
      expandViewBoxToFit(svg);
    };

    const handleClusterPointerUp = () => {
      if (!clusterDragCtx) return;

      if (clusterDragCtx.moved) {
        useHistoryStore.getState().commit();
        const svg = clusterDragCtx.clusterGroup.ownerSVGElement;
        if (svg) {
          clusterDragCtx.nodeIds.forEach((nodeId) => {
            const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
            if (!g) return;
            const transform = g.getAttribute('transform') ?? '';
            const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
            const x = m ? Number(m[1]) : 0;
            const y = m ? Number(m[2]) : 0;
            useDiagramStore.getState().setPositionOverride(nodeId, { x, y });
          });
        }
      }

      if (clusterDragCtx) {
        clusterDragCtx.clusterGroup.classList.remove('mf-cluster--dragging');
      }
      clusterDragCtx = null;
      window.removeEventListener('pointermove', handleClusterPointerMove);
      window.removeEventListener('pointerup', handleClusterPointerUp);
    };

    const handleClusterPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const clusterGroup = target?.closest('g.cluster') as SVGGElement | null;
      if (!clusterGroup) return;

      const clusterId = extractClusterUserId(clusterGroup.getAttribute('id') ?? '');
      if (!clusterId) return;

      // Select the cluster
      useSelectionStore.getState().selectCluster(clusterId);

      // Mermaid renders nodes in g.nodes and clusters in g.clusters as siblings —
      // node <g> elements are NOT children of the cluster <g>. Use the source
      // parser to discover which node IDs belong to this cluster.
      const source = useDiagramStore.getState().source;
      const membership = parseSubgraphMembership(source);
      const clusterMembers = membership.get(clusterId) ?? new Set<string>();

      const nodeIds: string[] = [];
      const nodeOriginalPositions = new Map<string, { x: number; y: number }>();

      const svg = clusterGroup.ownerSVGElement;
      if (!svg) return;

      svg.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
        const nodeId = g.getAttribute('data-node-id');
        if (nodeId && clusterMembers.has(nodeId)) {
          nodeIds.push(nodeId);
          const transform = g.getAttribute('transform') ?? '';
          const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
          const x = m ? Number(m[1]) : 0;
          const y = m ? Number(m[2]) : 0;
          nodeOriginalPositions.set(nodeId, { x, y });
        }
      });

      if (nodeIds.length === 0) return;

      clusterDragCtx = {
        clusterId,
        clusterGroup,
        nodeIds,
        nodeOriginalPositions,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };

      clusterGroup.classList.add('mf-cluster--dragging');
      e.stopPropagation();
      window.addEventListener('pointermove', handleClusterPointerMove as EventListener);
      window.addEventListener('pointerup', handleClusterPointerUp as EventListener);
    };

    // Attach pointerdown listener directly to SVG element with capture phase
    svgEl.addEventListener('pointerdown', handleClusterPointerDown as EventListener, true);
    return () => {
      svgEl.removeEventListener('pointerdown', handleClusterPointerDown as EventListener, true);
      window.removeEventListener('pointermove', handleClusterPointerMove as EventListener);
      window.removeEventListener('pointerup', handleClusterPointerUp as EventListener);
    };
  }, [svg]);

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
    // Reflect cluster selection.
    host.querySelectorAll('.mf-cluster--selected').forEach((el) => el.classList.remove('mf-cluster--selected'));
    if (selectedClusterId) {
      const clusters = Array.from(host.querySelectorAll<SVGGElement>('g.cluster'));
      const cluster = clusters.find((g) =>
        extractClusterUserId(g.getAttribute('id') ?? '') === selectedClusterId
      );
      cluster?.classList.add('mf-cluster--selected');
    }
  }, [selectedNodeIds, selectedEdgeIds, selectedClusterId, svg]);

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

function extractClusterUserId(rawId: string): string | null {
  // Common Mermaid patterns:
  //   flowchart-<userId>-<n>
  //   graph-<userId>-<n>
  //   <userId>-<n>  (older versions)
  const m =
    /^(?:flowchart|graph|subgraph)-(.+)-\d+$/.exec(rawId) ??
    /^(.+)-\d+$/.exec(rawId);
  return m ? m[1] : rawId || null;
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
