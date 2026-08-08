/**
 * useClusterDrag
 * --------------
 * Attaches pointer-drag handlers to subgraph cluster `<g class="cluster">`
 * elements inside the rendered SVG. Responsibilities:
 *
 *  - Select the cluster when the user presses down on it.
 *  - Move all member nodes (and nested sub-cluster members) together by the
 *    same delta during a drag.
 *  - Re-route edges and resize cluster rectangles on every pointer-move frame.
 *  - Commit final node positions to diagramStore on release so the layout
 *    survives subsequent Mermaid re-renders.
 *
 * Membership is derived from the live Mermaid source (parseSubgraphMembership
 * + collectAllNodeIds) because Mermaid's SVG does NOT nest node <g> elements
 * inside their cluster <g> — they are siblings.
 */
import { useEffect } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUiStore } from '@/stores/uiStore';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';
import { resizeClusters } from '../services/clusterResize';
import { parseSubgraphMembership, collectAllNodeIds } from '../services/cluster';
import { extractClusterUserId } from '../services/cluster/clusterElements';
import { cssEscape } from '../services/svg';

interface ClusterDragCtx {
  clusterId: string;
  clusterGroup: SVGGElement;
  /** All leaf node IDs that belong to this cluster (direct + nested). */
  nodeIds: string[];
  /** Node positions at drag start, in SVG-root coordinates. */
  nodeOriginalPositions: Map<string, { x: number; y: number }>;
  startX: number;
  startY: number;
  moved: boolean;
}

/** Parse the translate(x,y) of a node <g> element. */
function readNodeTranslate(g: SVGGElement): { x: number; y: number } {
  const t = g.getAttribute('transform') ?? '';
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(t);
  return { x: m ? Number(m[1]) : 0, y: m ? Number(m[2]) : 0 };
}

/**
 * Attach cluster-drag behaviour to the SVG inside `svgHostRef`.
 * Must be re-mounted whenever the SVG changes (pass `svg` as the dep string).
 */
export function useClusterDrag(
  svgHostRef: React.RefObject<HTMLElement>,
  svgDep: string,
): void {
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const svgEl = host.querySelector('svg');
    if (!svgEl) return;

    let ctx: ClusterDragCtx | null = null;

    // ── pointermove ───────────────────────────────────────────────────────────
    const handlePointerMove = (e: PointerEvent) => {
      if (!ctx) return;

      const zoom = useUiStore.getState().viewport.zoom || 1;
      const dx = (e.clientX - ctx.startX) / zoom;
      const dy = (e.clientY - ctx.startY) / zoom;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) ctx.moved = true;

      const svg = ctx.clusterGroup.ownerSVGElement;
      if (!svg) return;

      // Translate every member node by the same delta from its drag-start position.
      ctx.nodeIds.forEach((nodeId) => {
        const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
        if (!g) return;
        const orig = ctx!.nodeOriginalPositions.get(nodeId);
        if (orig) {
          g.setAttribute('transform', `translate(${orig.x + dx}, ${orig.y + dy})`);
        }
      });

      // Keep edges routed and cluster boxes resized every frame.
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

    // ── pointerup ─────────────────────────────────────────────────────────────
    const handlePointerUp = () => {
      if (!ctx) return;

      if (ctx.moved) {
        // Persist final positions so they survive the next Mermaid re-render.
        const svg = ctx.clusterGroup.ownerSVGElement;
        if (svg) {
          useHistoryStore.getState().commit();
          ctx.nodeIds.forEach((nodeId) => {
            const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
            if (!g) return;
            const pos = readNodeTranslate(g);
            useDiagramStore.getState().setPositionOverride(nodeId, pos);
          });
        }
      }

      ctx.clusterGroup.classList.remove('mf-cluster--dragging');
      ctx = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    // ── pointerdown ───────────────────────────────────────────────────────────
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const clusterGroup = target?.closest('g.cluster') as SVGGElement | null;
      if (!clusterGroup) return;

      const clusterId = extractClusterUserId(clusterGroup.getAttribute('id') ?? '');
      if (!clusterId) return;

      // Select this cluster (clears node/edge selection).
      useSelectionStore.getState().selectCluster(clusterId);

      // Discover member node IDs from the live Mermaid source.
      const source = useDiagramStore.getState().source;
      const membership = parseSubgraphMembership(source);
      const allNodeIds = collectAllNodeIds(clusterId, membership);

      const nodeIds: string[] = [];
      const nodeOriginalPositions = new Map<string, { x: number; y: number }>();

      const svg = clusterGroup.ownerSVGElement;
      if (!svg) return;

      svg.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
        const nodeId = g.getAttribute('data-node-id');
        if (nodeId && allNodeIds.has(nodeId)) {
          nodeIds.push(nodeId);
          nodeOriginalPositions.set(nodeId, readNodeTranslate(g));
        }
      });

      if (nodeIds.length === 0) return;

      ctx = {
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
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    };

    // Attach with capture so cluster events fire before the host's bubbling
    // node-drag handler, which also listens on the host.
    svgEl.addEventListener('pointerdown', handlePointerDown as EventListener, true);
    return () => {
      svgEl.removeEventListener('pointerdown', handlePointerDown as EventListener, true);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [svgHostRef, svgDep]);
}
