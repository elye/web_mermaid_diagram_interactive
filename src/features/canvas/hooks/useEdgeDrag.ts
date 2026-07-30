/**
 * useEdgeDrag
 * -----------
 * Two related edge-manipulation interactions wired to the rendered SVG:
 *
 * 1. **Anchor drag** — Dragging the source/target dot slides the arrow
 *    around the node perimeter and pins the new anchor to a specific
 *    side + offset in `diagramStore.edgeAnchorOverrides`.
 *
 * 2. **Waypoint drag** — Dragging the midpoint dot of a curve-mode edge
 *    (or of any self-loop) updates `diagramStore.edgeWaypoints`, which
 *    causes the router to emit a `waypointBezierPath` (C1-continuous
 *    chained cubic Béziers). Clicks below the drag threshold do NOT
 *    reshape the curve — the user must actually move the handle before
 *    any waypoint is committed.
 *
 * Architecture
 * ------------
 * Rather than touching the React VDOM on every pointer-move frame we
 * manipulate SVG DOM directly (same pattern as `useNodeDrag`) and only
 * write to the Zustand store on pointer-up so React re-renders happen at
 * most once per gesture.
 *
 * Handle rendering lives in `./edgeHandles`; small utilities in
 * `./edgeDragUtils`. This file owns the pointer-event lifecycle and the
 * store commits.
 */
import { useEffect } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useHistoryStore } from '@/stores/historyStore';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';
import { groupBBox } from '../services/svg';
import { snapToPerimeter } from '../services/routing/anchors';
import { HANDLE_CLASS, HANDLES_GROUP_CLASS, injectEdgeHandles } from './edgeHandles';
import { buildLineStyleMap, cssEscape, svgPoint } from './edgeDragUtils';

/**
 * Minimum pointer travel (screen pixels) before a waypoint interaction is
 * treated as a drag. Below this the gesture is a click — the store isn't
 * mutated and no history snapshot is committed.
 */
const DRAG_THRESHOLD_PX = 4;

// ─── Public hook ─────────────────────────────────────────────────────────

/**
 * @param svgHostRef  The container that holds the rendered SVG.
 * @param deps        External signals (e.g. selected-edge-ids + serialised
 *                    edge state) that should trigger handle re-injection.
 *                    Pass a stable primitive or shallow-serialised string;
 *                    undo/redo relies on this to redraw handles after a
 *                    silent store update.
 */
export function useEdgeDrag(svgHostRef: React.RefObject<HTMLElement>, deps?: unknown) {
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    // Re-inject handles for the current selection / edge state.
    injectEdgeHandles(host);

    let dragCtx: DragCtx | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      const handle = target.closest(`.${HANDLE_CLASS}`) as SVGCircleElement | null;
      if (!handle) return;

      const edgeId = handle.getAttribute('data-edge-id');
      const kind = handle.getAttribute('data-handle-kind') as DragKind | null;
      if (!edgeId || !kind) return;

      const svgEl = handle.ownerSVGElement;
      if (!svgEl) return;

      e.stopPropagation();
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);

      dragCtx =
        kind === 'waypoint'
          ? {
              kind: 'waypoint',
              edgeId,
              handle,
              svgEl,
              waypointIndex: Number(handle.getAttribute('data-waypoint-index') ?? 0),
              pointerId: e.pointerId,
              startClientX: e.clientX,
              startClientY: e.clientY,
              moved: false,
              committed: false,
            }
          : {
              kind: 'anchor',
              edgeId,
              handle,
              svgEl,
              role: handle.getAttribute('data-anchor-role') as 'source' | 'target',
              nodeId: handle.getAttribute('data-node-id') ?? '',
              pointerId: e.pointerId,
              committed: false,
            };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragCtx) return;

      // Waypoint drag: don't move anything until the pointer clears the
      // click/drag threshold. Prevents a stationary click from committing
      // a history snapshot or shifting the dot by sub-pixel jitter.
      if (dragCtx.kind === 'waypoint' && !dragCtx.moved) {
        const dx = e.clientX - dragCtx.startClientX;
        const dy = e.clientY - dragCtx.startClientY;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragCtx.moved = true;
      }

      // First move-that-mutates: snapshot BEFORE any store write so undo
      // can walk back to the pre-drag state.
      if (!dragCtx.committed) {
        useHistoryStore.getState().commit();
        dragCtx.committed = true;
      }

      const pt = svgPoint(dragCtx.svgEl, e.clientX, e.clientY);
      if (!pt) return;
      dragCtx.handle.setAttribute('cx', String(pt.x));
      dragCtx.handle.setAttribute('cy', String(pt.y));

      if (dragCtx.kind === 'waypoint') {
        applyWaypointMove(dragCtx, pt);
      } else {
        applyAnchorMove(dragCtx, pt);
      }
      expandViewBoxToFit(dragCtx.svgEl);
    };

    const onPointerUp = () => {
      if (!dragCtx) return;
      const ctx = dragCtx;
      dragCtx = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      if (ctx.kind === 'waypoint') {
        if (!ctx.moved) return; // pure click — nothing to persist
        commitWaypointDrop(ctx);
      } else {
        commitAnchorDrop(ctx);
      }

      // Re-inject handles so they reflect the newly persisted state.
      injectEdgeHandles(host);
    };

    host.addEventListener('pointerdown', onPointerDown as EventListener);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown as EventListener);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      host.querySelectorAll(`.${HANDLES_GROUP_CLASS}`).forEach((g) => g.remove());
    };
    // `deps` carries external signals (selectedEdgeIds, edgeStyles, edge
    // state snapshot) so handles are re-injected when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgHostRef, deps]);
}

// ─── Drag application (per-frame) ────────────────────────────────────────

function applyWaypointMove(ctx: WaypointDragCtx, pt: DOMPoint): void {
  const { svgEl, edgeId, waypointIndex } = ctx;
  const { edgeWaypoints, edgeAnchorOverrides } = useDiagramStore.getState();

  const existing = [...(edgeWaypoints[edgeId] ?? [])];
  existing[waypointIndex] = { x: pt.x, y: pt.y };

  const waypointMap = new Map(Object.entries(edgeWaypoints));
  waypointMap.set(edgeId, existing);

  // Auto-flow: while the user is shaping the curve via its waypoint,
  // drop any prior anchor override on THIS edge so the router re-derives
  // the anchor from geometry (facing the new waypoint direction).
  const anchorMap = new Map(Object.entries(edgeAnchorOverrides));
  anchorMap.delete(edgeId);

  routeAllEdges(svgEl, {
    lineStyles: buildLineStyleMap(useStyleStore.getState().edgeStyles),
    waypoints: waypointMap,
    anchorOverrides: anchorMap,
  });
}

function applyAnchorMove(ctx: AnchorDragCtx, pt: DOMPoint): void {
  const { svgEl, edgeId, role, nodeId, handle } = ctx;
  const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
  if (!nodeG) return;
  const rect = groupBBox(nodeG);
  if (!rect) return;

  const anchorOverride = snapToPerimeter(rect, { x: pt.x, y: pt.y });

  // Route with the new override.
  const { edgeWaypoints, edgeAnchorOverrides } = useDiagramStore.getState();
  const anchorMap = new Map(Object.entries(edgeAnchorOverrides));
  anchorMap.set(edgeId, {
    ...(edgeAnchorOverrides[edgeId] ?? {}),
    [role]: anchorOverride,
  });
  routeAllEdges(svgEl, {
    lineStyles: buildLineStyleMap(useStyleStore.getState().edgeStyles),
    waypoints: new Map(Object.entries(edgeWaypoints)),
    anchorOverrides: anchorMap,
  });

  // The handle re-injection at drop time will place the dot correctly on
  // the polygon outline. Mid-drag we leave the visual on the raw pointer
  // (or, if we want polygon snapping mid-drag, that's a future concern).
  handle.setAttribute('cx', String(pt.x));
  handle.setAttribute('cy', String(pt.y));
}

// ─── Drop commits (on pointerup) ─────────────────────────────────────────

function commitWaypointDrop(ctx: WaypointDragCtx): void {
  const { edgeId, handle, waypointIndex } = ctx;
  const finalX = Number(handle.getAttribute('cx'));
  const finalY = Number(handle.getAttribute('cy'));

  const store = useDiagramStore.getState();
  const existing = [...(store.edgeWaypoints[edgeId] ?? [])];
  existing[waypointIndex] = { x: finalX, y: finalY };

  store.setEdgeWaypoints(edgeId, existing);
  // Persist the auto-flow: dragging the waypoint means the user wants
  // anchors to follow the new curve direction.
  store.clearEdgeAnchorOverrides(edgeId);
}

function commitAnchorDrop(ctx: AnchorDragCtx): void {
  const { edgeId, svgEl, handle, role, nodeId } = ctx;
  const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
  const rect = nodeG ? groupBBox(nodeG) : null;
  if (!rect) return;

  const finalX = Number(handle.getAttribute('cx'));
  const finalY = Number(handle.getAttribute('cy'));
  const override = snapToPerimeter(rect, { x: finalX, y: finalY });
  useDiagramStore.getState().setEdgeAnchorOverride(edgeId, role, override);
}

// ─── Types ───────────────────────────────────────────────────────────────

type DragKind = 'waypoint' | 'anchor';

interface WaypointDragCtx {
  kind: 'waypoint';
  edgeId: string;
  handle: SVGCircleElement;
  svgEl: SVGSVGElement;
  waypointIndex: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  committed: boolean;
}

interface AnchorDragCtx {
  kind: 'anchor';
  edgeId: string;
  handle: SVGCircleElement;
  svgEl: SVGSVGElement;
  role: 'source' | 'target';
  nodeId: string;
  pointerId: number;
  committed: boolean;
}

type DragCtx = WaypointDragCtx | AnchorDragCtx;
