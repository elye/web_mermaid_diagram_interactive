/**
 * Edge-handle rendering: pure SVG DOM injection helpers used by
 * `useEdgeDrag`.
 *
 * Two kinds of handle circles are attached, per selected edge:
 *   • Waypoint handles (curve mode + self-loops) — draggable midpoints.
 *   • Anchor handles (all modes) — draggable source/target endpoints
 *     that slide around the node perimeter.
 *
 * Handles live directly in the live SVG (siblings of the edge paths) so
 * that pointer events and z-order match the rest of the drawing. They're
 * fully re-injected on every relevant store change; state is never
 * mutated in place.
 */
import type { BBox, EdgeLineStyle, Point } from '@/shared/types/diagram';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { pathMidpoint, groupBBox, groupPolygon } from '../services/svg';
import { anchorOn, anchorOnSide, centerOf, snapToPolygonOutline } from '../services/routing/anchors';
import { cssEscape } from './edgeDragUtils';

// ─── Constants (also consumed by the drag hook) ──────────────────────────

export const HANDLE_CLASS = 'mf-edge-handle';
export const HANDLES_GROUP_CLASS = 'mf-edge-handles';
const WAYPOINT_HANDLE_RADIUS = 6;
const ANCHOR_HANDLE_RADIUS = 5;
const ACCENT = 'var(--mf-accent, #0ea5e9)';

// ─── Public entry point ──────────────────────────────────────────────────

/**
 * Remove old handles and inject fresh ones for currently selected edges.
 * Safe to call as often as needed — the SVG is mutated in place.
 */
export function injectEdgeHandles(host: HTMLElement): void {
  const svgEl = host.querySelector<SVGSVGElement>('svg');
  if (!svgEl) return;

  svgEl.querySelectorAll(`.${HANDLES_GROUP_CLASS}`).forEach((g) => g.remove());

  const selectedEdgeIds = useSelectionStore.getState().selectedEdgeIds;
  if (selectedEdgeIds.size === 0) return;

  const edgeStyles = useStyleStore.getState().edgeStyles;
  const { edgeWaypoints, edgeAnchorOverrides } = useDiagramStore.getState();

  selectedEdgeIds.forEach((id) => {
    const path = svgEl.querySelector<SVGPathElement>(
      `path[data-edge-id="${cssEscape(id)}"]`,
    );
    if (!path) return;

    const lineStyle: EdgeLineStyle = (edgeStyles[id]?.lineStyle as EdgeLineStyle) ?? 'curve';
    const waypts = edgeWaypoints[id] ?? [];
    const anchors = edgeAnchorOverrides[id] ?? {};

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', HANDLES_GROUP_CLASS);
    g.setAttribute('data-edge-id', id);

    const srcId = path.getAttribute('data-edge-source');
    const tgtId = path.getAttribute('data-edge-target');
    const isSelfLoop = srcId !== null && srcId === tgtId;
    const isBundleEdge = path.hasAttribute('data-mf-bundle-cluster');

    // Waypoint handles: curve mode + all self-loops (regardless of style).
    if (lineStyle === 'curve' || isSelfLoop) {
      appendWaypointHandles(g, id, path, waypts);
    }

    if (isBundleEdge) {
      // Bundle overlay edges (collapsed-cluster summary arrows) don't have
      // data-edge-source/target — they use data-mf-bundle-cluster/external.
      // Show anchor handles at the pre-computed anchor coordinates stored
      // on the path, so the user can drag the line's endpoints.
      appendBundleAnchorHandles(g, svgEl, path, id);
    } else {
      // Anchor handles: always, on both ends, for every selected edge.
      if (srcId) {
        appendAnchorHandle(g, svgEl, id, srcId, tgtId, anchors.source, 'source');
      }
      if (tgtId) {
        appendAnchorHandle(g, svgEl, id, tgtId, srcId, anchors.target, 'target');
      }
    }

    // Append at SVG root so handles paint on top of edge labels.
    (path.ownerSVGElement ?? path.parentElement?.closest('svg') ?? path.parentElement)
      ?.appendChild(g);
  });
}

// ─── Internals ───────────────────────────────────────────────────────────

function appendWaypointHandles(
  g: SVGGElement,
  edgeId: string,
  path: SVGPathElement,
  waypts: readonly Point[],
): void {
  if (waypts.length > 0) {
    waypts.forEach((wp, i) => {
      g.appendChild(makeWaypointHandle(edgeId, wp.x, wp.y, i));
    });
    return;
  }
  // No stored waypoints yet — put the initial handle on the actual path
  // midpoint so it lines up with the drawn curve exactly.
  const mid = pathMidpoint(path);
  if (mid) g.appendChild(makeWaypointHandle(edgeId, mid.x, mid.y, 0));
}

/**
 * Inject anchor handles for a bundle overlay edge (collapsed-cluster summary
 * arrow). Bundle paths don't carry data-edge-source/target — instead they
 * store the pre-computed anchor coordinates in data-mf-src-x/y (cluster-side
 * anchor) and data-mf-tgt-x/y (external-node-side anchor).
 *
 * The external-node handle carries data-node-id so the existing anchor-drag
 * pipeline in useEdgeDrag can snap it around the node perimeter.
 * The cluster handle carries data-cluster-id so useEdgeDrag can snap it around
 * the collapsed cluster box perimeter.
 */
function appendBundleAnchorHandles(
  g: SVGGElement,
  svgEl: SVGSVGElement,
  path: SVGPathElement,
  edgeId: string,
): void {
  const sx = path.getAttribute('data-mf-src-x');
  const sy = path.getAttribute('data-mf-src-y');
  const tx = path.getAttribute('data-mf-tgt-x');
  const ty = path.getAttribute('data-mf-tgt-y');
  if (sx === null || sy === null || tx === null || ty === null) return;

  const clusterId = path.getAttribute('data-mf-bundle-cluster');
  const externalId = path.getAttribute('data-mf-bundle-external');
  const direction = path.getAttribute('data-mf-bundle-direction');
  if (!clusterId || !externalId) return;

  // Determine which end connects to which.
  // direction 'in':   src = external, tgt = cluster
  // direction 'out' / 'bidir': src = cluster, tgt = external
  const srcIsCluster = direction !== 'in';

  // Cluster-to-cluster bundles: externalId is another cluster id, not a node id.
  // Detect by checking whether a g[data-node-id] exists for it in the SVG.
  const externalIsCluster = !svgEl.querySelector(`g[data-node-id="${cssEscape(externalId)}"]`);

  // Source anchor handle.
  const srcHandle = makeAnchorHandle(edgeId, Number(sx), Number(sy), 'source',
    srcIsCluster ? null : (externalIsCluster ? null : externalId),
    srcIsCluster ? clusterId : (externalIsCluster ? externalId : null));
  g.appendChild(srcHandle);

  // Target anchor handle.
  const tgtHandle = makeAnchorHandle(edgeId, Number(tx), Number(ty), 'target',
    srcIsCluster ? (externalIsCluster ? null : externalId) : null,
    srcIsCluster ? (externalIsCluster ? externalId : null) : clusterId);
  g.appendChild(tgtHandle);
}

function appendAnchorHandle(
  g: SVGGElement,
  svgEl: SVGSVGElement,
  edgeId: string,
  nodeId: string,
  otherNodeId: string | null,
  override: { side: string; offset: number } | undefined,
  role: 'source' | 'target',
): void {
  const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
  if (!nodeG) return;
  const rect = groupBBox(nodeG);
  if (!rect) return;

  let pt = override
    ? anchorOnSide(rect, override as never)
    : computeDefaultAnchor(rect, svgEl, otherNodeId);
  if (!pt) return;

  // Non-rectangular shapes: snap onto the polygon outline so the handle
  // sits on the actual drawn boundary, not the bbox mid-side.
  const poly = groupPolygon(nodeG);
  if (poly) pt = snapToPolygonOutline(poly, pt);

  g.appendChild(makeAnchorHandle(edgeId, pt.x, pt.y, role, nodeId, null));
}

/** Auto-computed anchor on `rect` facing the OTHER node's centre. */
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

// ─── Handle factories ────────────────────────────────────────────────────

function makeWaypointHandle(
  edgeId: string,
  cx: number,
  cy: number,
  index: number,
): SVGCircleElement {
  const c = baseHandle(edgeId, cx, cy, WAYPOINT_HANDLE_RADIUS);
  c.setAttribute('data-handle-kind', 'waypoint');
  c.setAttribute('data-waypoint-index', String(index));
  c.style.fill = ACCENT;
  c.style.stroke = '#ffffff';
  c.style.strokeWidth = '2';
  c.style.cursor = 'move';
  return c;
}

function makeAnchorHandle(
  edgeId: string,
  cx: number,
  cy: number,
  role: 'source' | 'target',
  nodeId: string | null,
  clusterId?: string | null,
): SVGCircleElement {
  const c = baseHandle(edgeId, cx, cy, ANCHOR_HANDLE_RADIUS);
  c.setAttribute('data-handle-kind', 'anchor');
  c.setAttribute('data-anchor-role', role);
  if (nodeId) c.setAttribute('data-node-id', nodeId);
  if (clusterId) c.setAttribute('data-cluster-id', clusterId);
  // Filled dot at target end, hollow dot at source — matches arrow direction.
  c.style.fill = role === 'target' ? ACCENT : '#ffffff';
  c.style.stroke = ACCENT;
  c.style.strokeWidth = '2';
  c.style.cursor = 'crosshair';
  return c;
}

function baseHandle(
  edgeId: string,
  cx: number,
  cy: number,
  radius: number,
): SVGCircleElement {
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('class', HANDLE_CLASS);
  c.setAttribute('data-edge-id', edgeId);
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(radius));
  c.style.pointerEvents = 'all';
  return c;
}
