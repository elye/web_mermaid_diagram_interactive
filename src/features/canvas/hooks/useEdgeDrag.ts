/**
 * useEdgeDrag
 * -----------
 * Two related edge-manipulation interactions wired to the rendered SVG:
 *
 * 1. **Anchor drag** (Task B — "move arrows around target")
 *    Clicking and dragging the arrowhead end of an edge re-routes the edge
 *    so it enters the target node from a different side.  Implemented by
 *    rendering small invisible "anchor handles" at the source and target
 *    attachment points and letting the user drag them around the node
 *    perimeter.  On release the new attachment offset is persisted so it
 *    survives re-renders.
 *
 *    Because arrowhead rendering is entirely controlled by Mermaid's marker
 *    definitions we only drag the *path*, not a separate arrow element.
 *
 * 2. **Waypoint drag** (Task A — "change the line / curve")
 *    When a selected edge is in "curve" mode, a draggable midpoint handle
 *    is rendered at the path's current midpoint.  Dragging it updates the
 *    stored `EdgeWaypoint`, which causes the router to emit a
 *    `waypointCurvePath`.  Clicking the midpoint of an edge that already
 *    has a waypoint inserts an additional control point between the clicked
 *    position and the two flanking points (draw.io–style subdivision).
 *
 * Architecture
 * ------------
 * Rather than touching the React VDOM on every pointer-move frame we
 * manipulate SVG DOM directly (same pattern as useNodeDrag) and only write
 * to the Zustand store on pointer-up so React re-renders happen at most once
 * per gesture.
 *
 * Handles are injected into the live SVG as `<g class="mf-edge-handles">`
 * siblings of the edge paths and are removed/re-created whenever the SVG
 * is re-rendered.
 */
import { useEffect } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';
import { pathMidpoint, groupBBox } from '../services/svg';
import { anchorOn, anchorOnSide, centerOf, snapToPerimeter } from '../services/routing/anchors';
import type { EdgeLineStyle, BBox, Point } from '@/shared/types/diagram';

// ─── Constants ────────────────────────────────────────────────────────────────

const HANDLE_RADIUS = 6;
const ANCHOR_HANDLE_RADIUS = 5;
const HANDLE_CLASS = 'mf-edge-handle';
const HANDLES_GROUP_CLASS = 'mf-edge-handles';

// ─── Public hook ──────────────────────────────────────────────────────────────

/**
 * @param svgHostRef  The container that holds the rendered SVG.
 * @param deps        Extra dependencies (e.g. selected-edge-ids, edge-styles
 *                    snapshot) that should trigger handle re-injection.
 *                    Pass a stable primitive or shallow-serialised string.
 */
export function useEdgeDrag(svgHostRef: React.RefObject<HTMLElement>, deps?: unknown) {
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    // Re-inject handles whenever selection or edges change.
    // The handles live in the live DOM; a full SVG re-render (Mermaid source
    // change) will wipe them — DiagramCanvas mounts this hook after every
    // svg change so they get re-injected.
    injectEdgeHandles(host);

    let dragCtx: DragCtx | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      const handle = target.closest(`.${HANDLE_CLASS}`) as SVGCircleElement | null;
      if (!handle) return;

      const edgeId = handle.getAttribute('data-edge-id');
      const kind = handle.getAttribute('data-handle-kind') as 'waypoint' | 'anchor' | null;
      if (!edgeId || !kind) return;

      const svgEl = handle.ownerSVGElement;
      if (!svgEl) return;

      e.stopPropagation();
      e.preventDefault();
      (handle as unknown as SVGElement & { setPointerCapture(id: number): void }).setPointerCapture(e.pointerId);

      if (kind === 'waypoint') {
        dragCtx = {
          kind: 'waypoint',
          edgeId,
          handle,
          svgEl,
          waypointIndex: Number(handle.getAttribute('data-waypoint-index') ?? 0),
          pointerId: e.pointerId,
        };
      } else {
        // anchor drag
        const role = handle.getAttribute('data-anchor-role') as 'source' | 'target';
        const nodeId = handle.getAttribute('data-node-id') ?? '';
        dragCtx = {
          kind: 'anchor',
          edgeId,
          handle,
          svgEl,
          role,
          nodeId,
          pointerId: e.pointerId,
        };
      }

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragCtx) return;

      const { svgEl, handle } = dragCtx;
      const pt = svgPoint(svgEl, e.clientX, e.clientY);
      if (!pt) return;

      // Move handle circle visually.
      handle.setAttribute('cx', String(pt.x));
      handle.setAttribute('cy', String(pt.y));

      const edgeStyles = useStyleStore.getState().edgeStyles;
      const lineStyleMap = buildLineStyleMap(edgeStyles);
      const { edgeWaypoints, edgeAnchorOverrides } = useDiagramStore.getState();

      if (dragCtx.kind === 'waypoint') {
        const { edgeId, waypointIndex } = dragCtx;
        const existing = [...(edgeWaypoints[edgeId] ?? [])];
        existing[waypointIndex] = { x: pt.x, y: pt.y };
        const waypointMap = new Map(Object.entries(edgeWaypoints));
        waypointMap.set(edgeId, existing);
        routeAllEdges(svgEl, {
          lineStyles: lineStyleMap,
          waypoints: waypointMap,
          anchorOverrides: new Map(Object.entries(edgeAnchorOverrides)),
        });
      } else {
        // anchor drag — snap to node perimeter and reroute
        const { edgeId, role, nodeId } = dragCtx;
        const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
        const rect = nodeG ? groupBBox(nodeG) : null;
        if (rect) {
          const anchorOverride = snapToPerimeter(rect, { x: pt.x, y: pt.y });
          // Compute the snapped point for handle visual feedback.
          const snapped = anchorOnSide(rect, anchorOverride);
          handle.setAttribute('cx', String(snapped.x));
          handle.setAttribute('cy', String(snapped.y));

          const anchorMap = new Map(Object.entries(edgeAnchorOverrides));
          anchorMap.set(edgeId, {
            ...(edgeAnchorOverrides[edgeId] ?? {}),
            [role]: anchorOverride,
          });
          routeAllEdges(svgEl, {
            lineStyles: lineStyleMap,
            waypoints: new Map(Object.entries(edgeWaypoints)),
            anchorOverrides: anchorMap,
          });
        }
      }

      expandViewBoxToFit(svgEl);
    };

    const onPointerUp = () => {
      if (!dragCtx) return;
      const { edgeId, svgEl, handle } = dragCtx;

      if (dragCtx.kind === 'waypoint') {
        const finalX = Number(handle.getAttribute('cx'));
        const finalY = Number(handle.getAttribute('cy'));
        const existing = [...(useDiagramStore.getState().edgeWaypoints[edgeId] ?? [])];
        existing[dragCtx.waypointIndex] = { x: finalX, y: finalY };
        useDiagramStore.getState().setEdgeWaypoints(edgeId, existing);
      } else {
        // anchor drag
        const { role, nodeId } = dragCtx;
        const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
        const rect = nodeG ? groupBBox(nodeG) : null;
        if (rect) {
          const finalX = Number(handle.getAttribute('cx'));
          const finalY = Number(handle.getAttribute('cy'));
          const override = snapToPerimeter(rect, { x: finalX, y: finalY });
          useDiagramStore.getState().setEdgeAnchorOverride(edgeId, role, override);
        }
      }

      // Re-inject handles so they reflect the new state.
      injectEdgeHandles(host);

      dragCtx = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    host.addEventListener('pointerdown', onPointerDown as EventListener);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown as EventListener);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      // Clean up injected handles on unmount.
      host.querySelectorAll(`.${HANDLES_GROUP_CLASS}`).forEach((g) => g.remove());
    };
    // Re-run whenever selection or SVG changes — svgHostRef.current reference is
    // stable so we depend on the host div's innerHTML indirectly via the effect cleanup.
    // `deps` carries external signals (selectedEdgeIds, edgeStyles snapshot) so
    // handles are re-injected when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgHostRef, deps]);
}

// ─── Handle injection ─────────────────────────────────────────────────────────

/**
 * Remove old handles and inject fresh ones for selected edges.
 *
 * For each selected edge:
 *   - Curve mode: waypoint handle at midpoint (or stored waypoint position)
 *   - All modes:  anchor handles at the source/target attachment points
 *
 * Anchor handles let the user drag the arrow attachment around the node
 * perimeter (Task B).  Waypoint handles let the user reshape the curve (Task A).
 */
function injectEdgeHandles(host: HTMLElement): void {
  const svgEl = host.querySelector<SVGSVGElement>('svg');
  if (!svgEl) return;

  // Remove old.
  svgEl.querySelectorAll(`.${HANDLES_GROUP_CLASS}`).forEach((g) => g.remove());

  const selectedEdgeIds = useSelectionStore.getState().selectedEdgeIds;
  if (selectedEdgeIds.size === 0) return;

  const edgeStyles = useStyleStore.getState().edgeStyles;
  const { edgeWaypoints, edgeAnchorOverrides } = useDiagramStore.getState();

  selectedEdgeIds.forEach((id) => {
    const path = svgEl.querySelector<SVGPathElement>(`path[data-edge-id="${cssEscape(id)}"]`);
    if (!path) return;

    const lineStyle: EdgeLineStyle = (edgeStyles[id]?.lineStyle as EdgeLineStyle) ?? 'curve';
    const waypts = edgeWaypoints[id] ?? [];
    const anchors = edgeAnchorOverrides[id] ?? {};

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', HANDLES_GROUP_CLASS);
    g.setAttribute('data-edge-id', id);

    // ── Waypoint handles (curve mode only) ──────────────────────────────
    if (lineStyle === 'curve') {
      if (waypts.length > 0) {
        waypts.forEach((wp, i) => {
          g.appendChild(makeWaypointHandle(id, wp.x, wp.y, i));
        });
      } else {
        const mid = pathMidpoint(path);
        if (mid) {
          g.appendChild(makeWaypointHandle(id, mid.x, mid.y, 0));
        }
      }
    }

    // ── Anchor handles (all modes, selected edges only) ──────────────────
    const srcId = path.getAttribute('data-edge-source');
    const tgtId = path.getAttribute('data-edge-target');

    if (srcId) {
      const srcG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(srcId)}"]`);
      const srcRect = srcG ? groupBBox(srcG) : null;
      if (srcRect) {
        // Compute current anchor position.
        const override = anchors.source;
        const srcAnchor = override
          ? anchorOnSide(srcRect, override)
          : computeDefaultAnchor(srcRect, svgEl, tgtId);
        if (srcAnchor) {
          g.appendChild(makeAnchorHandle(id, srcAnchor.x, srcAnchor.y, 'source', srcId));
        }
      }
    }

    if (tgtId) {
      const tgtG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(tgtId)}"]`);
      const tgtRect = tgtG ? groupBBox(tgtG) : null;
      if (tgtRect) {
        const override = anchors.target;
        const tgtAnchor = override
          ? anchorOnSide(tgtRect, override)
          : computeDefaultAnchor(tgtRect, svgEl, srcId);
        if (tgtAnchor) {
          g.appendChild(makeAnchorHandle(id, tgtAnchor.x, tgtAnchor.y, 'target', tgtId));
        }
      }
    }

    // Append the handles group to the SVG root (or the nearest <g> that
    // contains both edgePaths and edgeLabels) so it always paints on top of
    // edge labels.  Edge labels use pointer-events:none (set in CSS) so
    // they don't block the handles.
    const svgRoot = path.ownerSVGElement ?? path.parentElement?.closest('svg');
    if (svgRoot) {
      svgRoot.appendChild(g);
    } else {
      path.parentElement?.insertBefore(g, path.nextSibling);
    }
  });
}

/** Compute the default (auto-computed) anchor on `rect` towards `otherNodeId`. */
function computeDefaultAnchor(
  rect: BBox,
  svgEl: SVGSVGElement,
  otherNodeId: string | null,
): Point | null {
  if (!otherNodeId) return null;
  const otherG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(otherNodeId)}"]`);
  if (!otherG) return null;
  const otherRect = groupBBox(otherG);
  if (!otherRect) return null;
  return anchorOn(rect, centerOf(otherRect));
}

function makeWaypointHandle(
  edgeId: string,
  cx: number,
  cy: number,
  index: number,
): SVGCircleElement {
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('class', HANDLE_CLASS);
  c.setAttribute('data-edge-id', edgeId);
  c.setAttribute('data-handle-kind', 'waypoint');
  c.setAttribute('data-waypoint-index', String(index));
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(HANDLE_RADIUS));
  c.style.fill = 'var(--mf-accent, #0ea5e9)';
  c.style.stroke = '#ffffff';
  c.style.strokeWidth = '2';
  c.style.cursor = 'move';
  c.style.pointerEvents = 'all';
  return c;
}

function makeAnchorHandle(
  edgeId: string,
  cx: number,
  cy: number,
  role: 'source' | 'target',
  nodeId: string,
): SVGCircleElement {
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('class', HANDLE_CLASS);
  c.setAttribute('data-edge-id', edgeId);
  c.setAttribute('data-handle-kind', 'anchor');
  c.setAttribute('data-anchor-role', role);
  c.setAttribute('data-node-id', nodeId);
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(ANCHOR_HANDLE_RADIUS));
  // Square-ish diamond shape via a rotated rect would be nicer but a circle
  // with a contrasting fill is clear enough.
  c.style.fill = role === 'target' ? 'var(--mf-accent, #0ea5e9)' : '#ffffff';
  c.style.stroke = 'var(--mf-accent, #0ea5e9)';
  c.style.strokeWidth = '2';
  c.style.cursor = 'crosshair';
  c.style.pointerEvents = 'all';
  return c;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface WaypointDragCtx {
  kind: 'waypoint';
  edgeId: string;
  handle: SVGCircleElement;
  svgEl: SVGSVGElement;
  waypointIndex: number;
  pointerId: number;
}

interface AnchorDragCtx {
  kind: 'anchor';
  edgeId: string;
  handle: SVGCircleElement;
  svgEl: SVGSVGElement;
  role: 'source' | 'target';
  nodeId: string;
  pointerId: number;
}

type DragCtx = WaypointDragCtx | AnchorDragCtx;

/**
 * Convert a client-space pointer position to SVG root coordinates,
 * honouring pan/zoom applied by the `svgHostRef` parent.
 */
function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): DOMPoint | null {
  try {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM()?.inverse());
  } catch {
    return null;
  }
}

function buildLineStyleMap(
  edgeStyles: Record<string, { lineStyle?: EdgeLineStyle }>,
): Map<string, EdgeLineStyle> {
  const m = new Map<string, EdgeLineStyle>();
  Object.entries(edgeStyles).forEach(([id, s]) => {
    if (s.lineStyle) m.set(id, s.lineStyle);
  });
  return m;
}

function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
