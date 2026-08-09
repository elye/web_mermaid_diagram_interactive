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
import { snapToPerimeter, anchorOnSide } from '../services/routing/anchors';
import { clusterElementBBox } from '../services/cluster/clusterElements';
import { waypointBezierPath } from '../services/routing/bezierChain';
import type { BBox } from '@/shared/types/diagram';
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
              clusterId: handle.getAttribute('data-cluster-id') ?? '',
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

  // If this is a bundle edge (has data-mf-bundle-cluster), redraw it directly
  // using the C1-continuous waypoint bezier — it's not part of routeAllEdges.
  const bundlePath = svgEl.querySelector<SVGPathElement>(
    `path[data-edge-id="${cssEscape(edgeId)}"][data-mf-bundle-cluster]`,
  );
  if (bundlePath) {
    applyBundleWaypointLive(bundlePath, { x: pt.x, y: pt.y });
    // Keep the wide hit path in sync so it remains clickable at its new position.
    const hitPath = svgEl.querySelector<SVGPathElement>(
      `.mf-edge-hit[data-hit-edge-id="${cssEscape(edgeId)}"]`,
    );
    if (hitPath) hitPath.setAttribute('d', bundlePath.getAttribute('d') ?? '');
    return; // skip routeAllEdges for bundle edges
  }

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

/**
 * Redraw a bundle edge path so it passes through `wp`, using the same
 * C1-continuous chained Bézier algorithm as regular edges (waypointBezierPath).
 *
 * Reads src/tgt anchor points and their outward tangents from the data
 * attributes stored by useClusterCollapse when the path was first drawn.
 * Falls back to extracting src/tgt from the `d` attribute (no tangents)
 * if those attributes are absent.
 */
function applyBundleWaypointLive(path: SVGPathElement, wp: { x: number; y: number }): void {
  const zeroBBox: BBox = { x: 0, y: 0, width: 0, height: 0 };

  // Prefer the stored anchor points (exact values, not rounded path coords).
  const sx = path.getAttribute('data-mf-src-x');
  const sy = path.getAttribute('data-mf-src-y');
  const tx = path.getAttribute('data-mf-tgt-x');
  const ty = path.getAttribute('data-mf-tgt-y');
  const stx = path.getAttribute('data-mf-src-tx');
  const sty = path.getAttribute('data-mf-src-ty');
  const ttx = path.getAttribute('data-mf-tgt-tx');
  const tty = path.getAttribute('data-mf-tgt-ty');

  let src: { x: number; y: number };
  let tgt: { x: number; y: number };
  let srcTangent: { x: number; y: number } | undefined;
  let tgtTangent: { x: number; y: number } | undefined;

  if (sx !== null && sy !== null && tx !== null && ty !== null) {
    src = { x: Number(sx), y: Number(sy) };
    tgt = { x: Number(tx), y: Number(ty) };
    if (stx !== null && sty !== null) srcTangent = { x: Number(stx), y: Number(sty) };
    if (ttx !== null && tty !== null) tgtTangent = { x: Number(ttx), y: Number(tty) };
  } else {
    // Fallback: extract first/last coords from `d` attribute.
    const d = path.getAttribute('d') ?? '';
    const nums = (d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    if (nums.length < 4) return;
    src = { x: nums[0], y: nums[1] };
    tgt = { x: nums[nums.length - 2], y: nums[nums.length - 1] };
  }

  const newD = waypointBezierPath(src, [wp], tgt, zeroBBox, zeroBBox, srcTangent, tgtTangent);
  path.setAttribute('d', newD);
}

function applyAnchorMove(ctx: AnchorDragCtx, pt: DOMPoint): void {
  const { svgEl, edgeId, role, nodeId, clusterId, handle } = ctx;

  // Bundle-edge anchor: redraw the bundle path with the updated endpoint.
  const bundlePath = svgEl.querySelector<SVGPathElement>(
    `path[data-edge-id="${cssEscape(edgeId)}"][data-mf-bundle-cluster]`,
  );
  if (bundlePath) {
    applyBundleAnchorLive(bundlePath, svgEl, role, nodeId, clusterId, pt);
    // Sync hit path.
    const hitPath = svgEl.querySelector<SVGPathElement>(
      `.mf-edge-hit[data-hit-edge-id="${cssEscape(edgeId)}"]`,
    );
    if (hitPath) hitPath.setAttribute('d', bundlePath.getAttribute('d') ?? '');
    handle.setAttribute('cx', String(pt.x));
    handle.setAttribute('cy', String(pt.y));
    return;
  }

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

/**
 * Redraw a bundle edge path live during anchor-handle drag.
 * Updates the anchor endpoint (`src` or `tgt`) on the path to a new point
 * snapped to the perimeter of the relevant node/cluster box, then redraws.
 */
function applyBundleAnchorLive(
  path: SVGPathElement,
  svgEl: SVGSVGElement,
  role: 'source' | 'target',
  nodeId: string,
  clusterId: string,
  pt: DOMPoint,
): void {
  const zeroBBox: BBox = { x: 0, y: 0, width: 0, height: 0 };

  // Read all current anchor/tangent data.
  const sx = Number(path.getAttribute('data-mf-src-x') ?? '0');
  const sy = Number(path.getAttribute('data-mf-src-y') ?? '0');
  const tx = Number(path.getAttribute('data-mf-tgt-x') ?? '0');
  const ty = Number(path.getAttribute('data-mf-tgt-y') ?? '0');
  const stx = Number(path.getAttribute('data-mf-src-tx') ?? '0');
  const sty = Number(path.getAttribute('data-mf-src-ty') ?? '0');
  const ttx = Number(path.getAttribute('data-mf-tgt-tx') ?? '0');
  const tty = Number(path.getAttribute('data-mf-tgt-ty') ?? '0');

  // Snap the cursor to the correct element's perimeter.
  let newPt = { x: pt.x, y: pt.y };
  if (nodeId) {
    const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
    const rect = nodeG ? groupBBox(nodeG) : null;
    if (rect) {
      const override = snapToPerimeter(rect, { x: pt.x, y: pt.y });
      newPt = anchorOnSide(rect, override);
    }
  } else if (clusterId) {
    const clusterG = svgEl.querySelector<SVGGElement>(`g[id="${cssEscape(clusterId)}"]`);
    const rect = clusterG ? clusterElementBBox(clusterG as SVGGElement) : null;
    if (rect) {
      const override = snapToPerimeter(rect, { x: pt.x, y: pt.y });
      newPt = anchorOnSide(rect, override);
    }
  }

  // Update the relevant endpoint and recompute tangent.
  let srcPt = { x: sx, y: sy };
  let tgtPt = { x: tx, y: ty };
  let srcTangent = { x: stx, y: sty };
  let tgtTangent = { x: ttx, y: tty };

  if (role === 'source') {
    srcPt = newPt;
    // Update the data attribute so applyBundleWaypointLive uses the new position.
    path.setAttribute('data-mf-src-x', String(newPt.x));
    path.setAttribute('data-mf-src-y', String(newPt.y));
  } else {
    tgtPt = newPt;
    path.setAttribute('data-mf-tgt-x', String(newPt.x));
    path.setAttribute('data-mf-tgt-y', String(newPt.y));
  }

  // Rebuild path: pass through any stored waypoint using the C1-continuous
  // algorithm, or fall back to a direct S-curve when no waypoints exist.
  const { edgeWaypoints } = useDiagramStore.getState();
  const wp = edgeWaypoints[path.getAttribute('data-edge-id') ?? '']?.[0];
  const waypts = wp ? [wp] : [];
  const newD = waypointBezierPath(srcPt, waypts, tgtPt, zeroBBox, zeroBBox, srcTangent, tgtTangent);
  path.setAttribute('d', newD);
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
  const { edgeId, svgEl, handle, role, nodeId, clusterId } = ctx;

  // Bundle edge anchor drop: read the final endpoint coords directly from the
  // path attributes (updated live by applyBundleAnchorLive) and persist them
  // as an anchor override so rebuildBundleOverlays can restore the position.
  const bundlePath = svgEl.querySelector<SVGPathElement>(
    `path[data-edge-id="${cssEscape(edgeId)}"][data-mf-bundle-cluster]`,
  );
  if (bundlePath) {
    const finalX = Number(role === 'source'
      ? bundlePath.getAttribute('data-mf-src-x')
      : bundlePath.getAttribute('data-mf-tgt-x'));
    const finalY = Number(role === 'source'
      ? bundlePath.getAttribute('data-mf-src-y')
      : bundlePath.getAttribute('data-mf-tgt-y'));
    // Determine the reference element to snap the anchor.
    let rect: ReturnType<typeof groupBBox> = null;
    if (nodeId) {
      const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
      rect = nodeG ? groupBBox(nodeG) : null;
    } else if (clusterId) {
      const clusterG = svgEl.querySelector<SVGGElement>(`g[id="${cssEscape(clusterId)}"]`);
      rect = clusterG ? clusterElementBBox(clusterG as SVGGElement) : null;
    }
    if (rect) {
      const override = snapToPerimeter(rect, { x: finalX, y: finalY });
      useDiagramStore.getState().setEdgeAnchorOverride(edgeId, role, override);
    }
    return;
  }

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
  /** For bundle-edge cluster-side anchors: the cluster ID of the collapsed box. */
  clusterId: string;
  pointerId: number;
  committed: boolean;
}

type DragCtx = WaypointDragCtx | AnchorDragCtx;
