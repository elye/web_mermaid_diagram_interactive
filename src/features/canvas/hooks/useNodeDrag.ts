/**
 * useNodeDrag
 * -----------
 * Attaches pointer-drag handlers to node <g> elements inside the rendered
 * SVG. Responsibilities:
 *
 *  - Update the group's `transform="translate(x,y)"` live during drag.
 *  - Re-route ALL connected edges on every pointer-move via the shared
 *    edgeRouter, so lines stay glued to node sides.
 *  - Expand the SVG viewBox on-the-fly so nodes never disappear off-canvas.
 *  - Commit the final position to diagramStore.positionOverrides on release
 *    (this survives Mermaid re-renders — DiagramCanvas re-applies overrides
 *    after every new render).
 *  - Support multi-node drag: if the pressed node is part of the current
 *    selection, every selected node moves together by the same delta.
 */
import { useEffect } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUiStore } from '@/stores/uiStore';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';
import { resizeClusters } from '../services/clusterResize';

interface DragTarget {
  id: string;
  group: SVGGElement;
  origX: number;
  origY: number;
}

interface DragCtx {
  primaryId: string;
  targets: DragTarget[];
  pointerStartX: number;
  pointerStartY: number;
  svg: SVGSVGElement;
  moved: boolean;
}

interface ClusterDragCtx {
  clusterId: string;
  clusterGroup: SVGGElement;
  targets: DragTarget[];
  pointerStartX: number;
  pointerStartY: number;
  svg: SVGSVGElement;
  moved: boolean;
}

export function useNodeDrag(svgHostRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    let ctx: DragCtx | null = null;
    let clusterDragCtx: ClusterDragCtx | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;

      // Check for cluster click first (must check before node, as nodes can be inside clusters)
      const clusterGroup = target?.closest('g.cluster') as SVGGElement | null;
      if (clusterGroup) {
        const clusterId = extractClusterUserId(clusterGroup.getAttribute('id') ?? '');
        if (clusterId) {
          handleClusterPointerDown(e, clusterGroup, clusterId);
          return;
        }
      }

      // Check if we clicked inside the cluster but want to select the cluster (click on rect or label)
      // This handles clicking on the cluster's rect/label directly
      const nodeInCluster = target?.closest('g[data-node-id]');
      if (nodeInCluster) {
        const clusterParent = nodeInCluster.closest('g.cluster') as SVGGElement | null;
        // If we're holding Shift or already have the node selected, do normal node drag
        // Otherwise, if there's a cluster parent and we're just clicking (not already on a selected node),
        // try to interpret as cluster click
        if (!clusterParent || e.shiftKey) {
          // Fall through to normal node handling
        } else {
          // Normal node click - fall through
        }
      }

      // Otherwise handle normal node drag
      const group = target?.closest('g[data-node-id]') as SVGGElement | null;
      if (!group) return;

      const id = group.getAttribute('data-node-id')!;
      const svg = group.ownerSVGElement;
      if (!svg) return;

      // Update selection: additive on Shift, replace otherwise (unless
      // clicking a node that's already part of a multi-select — preserve it).
      const selection = useSelectionStore.getState();
      const alreadySelected = selection.selectedNodeIds.has(id);
      if (!e.shiftKey && !alreadySelected) {
        selection.select(id, false);
      } else if (e.shiftKey) {
        selection.select(id, true);
      }

      // Collect drag targets: all selected nodes if the pressed one is in
      // the selection AND there is more than one; otherwise just the pressed.
      const selected = useSelectionStore.getState().selectedNodeIds;
      const ids = selected.has(id) && selected.size > 1 ? Array.from(selected) : [id];

      const targets: DragTarget[] = [];
      ids.forEach((nid) => {
        const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nid)}"]`);
        if (!g) return;
        const { x, y } = readTranslate(g);
        targets.push({ id: nid, group: g, origX: x, origY: y });
      });
      if (targets.length === 0) return;

      ctx = {
        primaryId: id,
        targets,
        pointerStartX: e.clientX,
        pointerStartY: e.clientY,
        svg,
        moved: false,
      };
      targets.forEach((t) => t.group.classList.add('mf-node--dragging'));
      e.stopPropagation();
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const handleClusterPointerDown = (e: PointerEvent, clusterGroup: SVGGElement, clusterId: string) => {
      useSelectionStore.getState().selectCluster(clusterId);
      
      const svg = clusterGroup.ownerSVGElement;
      if (!svg) return;

      // Get all nodes inside this cluster
      const nodesInCluster = new Set<string>();
      clusterGroup.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
        const nodeId = g.getAttribute('data-node-id');
        if (nodeId) nodesInCluster.add(nodeId);
      });

      // Collect drag targets for all nodes in the cluster
      const targets: DragTarget[] = [];
      nodesInCluster.forEach((nid) => {
        const g = svg.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nid)}"]`);
        if (!g) return;
        const { x, y } = readTranslate(g);
        targets.push({ id: nid, group: g, origX: x, origY: y });
      });
      if (targets.length === 0) return;

      clusterDragCtx = {
        clusterId,
        clusterGroup,
        targets,
        pointerStartX: e.clientX,
        pointerStartY: e.clientY,
        svg,
        moved: false,
      };
      clusterGroup.classList.add('mf-cluster--dragging');
      targets.forEach((t) => t.group.classList.add('mf-node--dragging'));
      e.stopPropagation();
      window.addEventListener('pointermove', onClusterPointerMove);
      window.addEventListener('pointerup', onClusterPointerUp);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!ctx) return;
      const zoom = useUiStore.getState().viewport.zoom || 1;
      const dx = (e.clientX - ctx.pointerStartX) / zoom;
      const dy = (e.clientY - ctx.pointerStartY) / zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) ctx.moved = true;

      ctx.targets.forEach((t) => {
        writeTranslate(t.group, t.origX + dx, t.origY + dy);
      });

      // Route every edge every frame — cheap for typical diagrams and
      // guarantees adjacent edges (even for non-dragged nodes) stay hooked up.
      // Pass current store state so line-style / waypoint / anchor overrides are respected.
      const { edgeWaypoints, edgeAnchorOverrides } = useDiagramStore.getState();
      const edgeStyles = useStyleStore.getState().edgeStyles;
      const lineStyles = new Map(
        Object.entries(edgeStyles)
          .filter(([, s]) => s.lineStyle)
          .map(([id, s]) => [id, s.lineStyle!] as const),
      );
      routeAllEdges(ctx.svg, {
        lineStyles,
        waypoints: new Map(Object.entries(edgeWaypoints)),
        anchorOverrides: new Map(Object.entries(edgeAnchorOverrides)),
      });
      // Resize subgraph cluster rectangles to keep wrapping their members.
      resizeClusters(ctx.svg, useDiagramStore.getState().source);
      expandViewBoxToFit(ctx.svg);
    };

    const onPointerUp = () => {
      if (!ctx) return;
      const wasMoved = ctx.moved;
      const finals = ctx.targets.map((t) => {
        t.group.classList.remove('mf-node--dragging');
        const { x, y } = readTranslate(t.group);
        return { id: t.id, x, y };
      });

      if (wasMoved) {
        useHistoryStore.getState().commit();
        finals.forEach(({ id, x, y }) => {
          useDiagramStore.getState().setPositionOverride(id, { x, y });
        });
      }
      ctx = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    const onClusterPointerMove = (e: PointerEvent) => {
      if (!clusterDragCtx) return;
      const zoom = useUiStore.getState().viewport.zoom || 1;
      const dx = (e.clientX - clusterDragCtx.pointerStartX) / zoom;
      const dy = (e.clientY - clusterDragCtx.pointerStartY) / zoom;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) clusterDragCtx.moved = true;

      // Move all nodes in the cluster by the same delta
      clusterDragCtx.targets.forEach((t) => {
        writeTranslate(t.group, t.origX + dx, t.origY + dy);
      });

      // Route every edge and resize clusters
      const { edgeWaypoints, edgeAnchorOverrides } = useDiagramStore.getState();
      const edgeStyles = useStyleStore.getState().edgeStyles;
      const lineStyles = new Map(
        Object.entries(edgeStyles)
          .filter(([, s]) => s.lineStyle)
          .map(([id, s]) => [id, s.lineStyle!] as const),
      );
      routeAllEdges(clusterDragCtx.svg, {
        lineStyles,
        waypoints: new Map(Object.entries(edgeWaypoints)),
        anchorOverrides: new Map(Object.entries(edgeAnchorOverrides)),
      });
      resizeClusters(clusterDragCtx.svg, useDiagramStore.getState().source);
      expandViewBoxToFit(clusterDragCtx.svg);
    };

    const onClusterPointerUp = () => {
      if (!clusterDragCtx) return;
      const wasMoved = clusterDragCtx.moved;
      const finals = clusterDragCtx.targets.map((t) => {
        t.group.classList.remove('mf-node--dragging');
        const { x, y } = readTranslate(t.group);
        return { id: t.id, x, y };
      });
      clusterDragCtx.clusterGroup.classList.remove('mf-cluster--dragging');

      if (wasMoved) {
        useHistoryStore.getState().commit();
        finals.forEach(({ id, x, y }) => {
          useDiagramStore.getState().setPositionOverride(id, { x, y });
        });
      }
      clusterDragCtx = null;
      window.removeEventListener('pointermove', onClusterPointerMove);
      window.removeEventListener('pointerup', onClusterPointerUp);
    };

    host.addEventListener('pointerdown', onPointerDown as EventListener);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown as EventListener);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointermove', onClusterPointerMove);
      window.removeEventListener('pointerup', onClusterPointerUp);
    };
  }, [svgHostRef]);
}

function readTranslate(g: SVGGElement): { x: number; y: number } {
  const t = g.getAttribute('transform') ?? '';
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(t);
  return { x: m ? Number(m[1]) : 0, y: m ? Number(m[2]) : 0 };
}

function writeTranslate(g: SVGGElement, x: number, y: number) {
  g.setAttribute('transform', `translate(${x}, ${y})`);
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
