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

export function useNodeDrag(svgHostRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    let ctx: DragCtx | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;

      // Handle normal node drag (clusters are handled via click in DiagramCanvas)
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

    host.addEventListener('pointerdown', onPointerDown as EventListener);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown as EventListener);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
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
