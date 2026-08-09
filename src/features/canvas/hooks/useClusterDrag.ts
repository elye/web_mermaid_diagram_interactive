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
import { rebuildBundleOverlays } from './useClusterCollapse';

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
  /**
   * When the cluster is collapsed we also translate the cluster <g> itself
   * (the member nodes are hidden). Record the cluster's original translate.
   */
  isCollapsed: boolean;
  clusterOriginalPos: { x: number; y: number };
  /**
   * Nested collapsed cluster <g> elements that must be translated alongside
   * member nodes when dragging a non-collapsed outer cluster. These are
   * hidden (display:none) so they won't be picked up by the node loop, but
   * their DOM positions still need to stay in sync so bundle overlay edges
   * render at the correct location during the drag.
   */
  nestedCollapsedClusters: Array<{ g: SVGGElement; ox: number; oy: number }>;
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

      if (!ctx.isCollapsed) {
        // Translate every member node by the same delta from its drag-start position.
        // For collapsed clusters we skip this — member nodes are hidden (display:none)
        // and we translate the cluster <g> directly instead.
        ctx.nodeIds.forEach((nodeId) => {
          const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
          if (!g) return;
          const orig = ctx!.nodeOriginalPositions.get(nodeId);
          if (orig) {
            g.setAttribute('transform', `translate(${orig.x + dx}, ${orig.y + dy})`);
          }
        });
        // Also translate any nested collapsed cluster <g> elements — these are
        // hidden (display:none) so the node loop above skips them, but their
        // DOM translate must stay in sync so bundle overlays draw correctly.
        for (const { g, ox, oy } of ctx.nestedCollapsedClusters) {
          g.setAttribute('transform', `translate(${ox + dx}, ${oy + dy})`);
        }
      }

      // Keep edges routed and cluster boxes resized every frame.
      const { edgeWaypoints, edgeAnchorOverrides, source } = useDiagramStore.getState();
      const edgeStyles = useStyleStore.getState().edgeStyles;
      const lineStyles = new Map(
        Object.entries(edgeStyles)
          .filter(([, s]) => s.lineStyle)
          .map(([id, s]) => [id, s.lineStyle!] as const),
      );

      const { collapsedClusters } = useDiagramStore.getState();

      if (ctx.isCollapsed) {
        // For a collapsed cluster: translate the cluster <g> directly.
        // Pass collapsedClusters to resizeClusters so it skips the collapsed
        // cluster's own rect (which we're dragging) but DOES refit any parent
        // cluster box around the moved collapsed child.
        const { x: ox, y: oy } = ctx.clusterOriginalPos;
        ctx.clusterGroup.setAttribute('transform', `translate(${ox + dx}, ${oy + dy})`);
        // Reroute normal (non-bundle) edges and rebuild bundle overlays.
        routeAllEdges(svg, {
          lineStyles,
          waypoints: new Map(Object.entries(edgeWaypoints)),
          anchorOverrides: new Map(Object.entries(edgeAnchorOverrides)),
        });
        rebuildBundleOverlays(svg);
        // Refit parent cluster boxes around the moved collapsed child.
        resizeClusters(svg, source, collapsedClusters);
      } else {
        routeAllEdges(svg, {
          lineStyles,
          waypoints: new Map(Object.entries(edgeWaypoints)),
          anchorOverrides: new Map(Object.entries(edgeAnchorOverrides)),
        });
        resizeClusters(svg, source, collapsedClusters);
        // If any other clusters are collapsed, rebuild bundle overlay edges so
        // they stay anchored to the nodes we just moved.
        if (collapsedClusters.size > 0) {
          rebuildBundleOverlays(svg);
        }
      }
      expandViewBoxToFit(svg);
    };

    // ── pointerup ─────────────────────────────────────────────────────────────
    const handlePointerUp = () => {
      if (!ctx) return;

      if (ctx.moved) {
        const svg = ctx.clusterGroup.ownerSVGElement;
        if (svg) {
          useHistoryStore.getState().commit();

          if (ctx.isCollapsed) {
            // Persist the shifted positions for all member nodes.
            // These nodes are hidden (display:none) but still have their transforms.
            // When the cluster is later expanded, DiagramCanvas re-applies
            // positionOverrides which positions nodes correctly, and resizeClusters
            // will refit the cluster box around them.
            //
            // Compute the drag delta from the cluster <g>'s final transform.
            const finalTransform = ctx.clusterGroup.getAttribute('transform') ?? '';
            const fm = /translate\(\s*([+-]?\d*\.?\d+)[\s,]+([+-]?\d*\.?\d+)\s*\)/.exec(finalTransform);
            const finalX = fm ? Number(fm[1]) : ctx.clusterOriginalPos.x;
            const finalY = fm ? Number(fm[2]) : ctx.clusterOriginalPos.y;
            const ddx = finalX - ctx.clusterOriginalPos.x;
            const ddy = finalY - ctx.clusterOriginalPos.y;

            ctx.nodeIds.forEach((nodeId) => {
              const origPos = ctx!.nodeOriginalPositions.get(nodeId);
              if (!origPos) return;
              useDiagramStore.getState().setPositionOverride(nodeId, {
                x: origPos.x + ddx,
                y: origPos.y + ddy,
              });
            });
          } else {
            ctx.nodeIds.forEach((nodeId) => {
              const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
              if (!g) return;
              const pos = readNodeTranslate(g);
              useDiagramStore.getState().setPositionOverride(nodeId, pos);
            });
          }
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
      const { source, collapsedClusters } = useDiagramStore.getState();
      const membership = parseSubgraphMembership(source);
      const allNodeIds = collectAllNodeIds(clusterId, membership);

      const nodeIds: string[] = [];
      const nodeOriginalPositions = new Map<string, { x: number; y: number }>();

      const svg = clusterGroup.ownerSVGElement;
      if (!svg) return;

      // Collect member node positions — including hidden ones (collapsed state).
      svg.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
        const nodeId = g.getAttribute('data-node-id');
        if (nodeId && allNodeIds.has(nodeId)) {
          nodeIds.push(nodeId);
          nodeOriginalPositions.set(nodeId, readNodeTranslate(g));
        }
      });

      const isCollapsed = collapsedClusters.has(clusterId);
      // For collapsed clusters we need at least the cluster group to move even
      // if there are somehow no member nodes recorded.
      if (!isCollapsed && nodeIds.length === 0) return;

      // Record the cluster <g> original translate for collapsed-drag mode.
      const clusterOriginalPos = readNodeTranslate(clusterGroup as unknown as SVGGElement);

      // For non-collapsed outer clusters: find any nested sub-clusters that are
      // themselves collapsed (hidden display:none). We must track their <g>
      // positions and translate them alongside the member nodes so bundle
      // overlay edges stay correct during the drag.
      const nestedCollapsedClusters: Array<{ g: SVGGElement; ox: number; oy: number }> = [];
      if (!isCollapsed && collapsedClusters.size > 0) {
        // BFS over the membership tree to collect all nested sub-cluster IDs.
        const nestedSubIds: string[] = [];
        const queue = [clusterId];
        const visited = new Set<string>();
        while (queue.length) {
          const cur = queue.shift()!;
          if (visited.has(cur)) continue;
          visited.add(cur);
          const members = membership.get(cur);
          if (!members) continue;
          for (const m of members) {
            if (membership.has(m)) {
              nestedSubIds.push(m);
              queue.push(m);
            }
          }
        }
        // For each nested sub-cluster that is currently collapsed, record its
        // <g> element and original position.
        const clusterEls = svg.querySelectorAll<SVGGElement>('g.cluster');
        clusterEls.forEach((g) => {
          const rawId = g.getAttribute('id') ?? '';
          // Re-use the same extractClusterUserId logic.
          const uid = extractClusterUserId(rawId);
          if (uid && nestedSubIds.includes(uid) && collapsedClusters.has(uid)) {
            nestedCollapsedClusters.push({ g, ox: readNodeTranslate(g).x, oy: readNodeTranslate(g).y });
          }
        });
      }

      ctx = {
        clusterId,
        clusterGroup,
        nodeIds,
        nodeOriginalPositions,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        isCollapsed,
        clusterOriginalPos,
        nestedCollapsedClusters,
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
