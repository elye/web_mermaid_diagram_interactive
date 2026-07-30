/**
 * Path shape emitters — pure functions from geometry to SVG `d` strings.
 * Kept UI-agnostic: routers may pick between these based on edge topology.
 *
 * Supported styles:
 *   bezierPath      — smooth cubic bezier (default, "curve")
 *   straightPath    — single straight line segment
 *   orthogonalPath  — two axis-aligned segments (L-shaped / Z-shaped)
 *   waypointCurvePath — cubic bezier routed through a user-dragged midpoint
 *   selfLoopPath    — kidney loop for self-edges
 */
import type { BBox, Point } from '@/shared/types/diagram';

/**
 * Smooth cubic bezier between two anchor points. Control points are
 * offset in the "outgoing" direction of the anchor to produce clean
 * S-curves for L→R / T→B / diagonal edges alike.
 *
 * The bend distance is proportional to the endpoint separation but
 * clamped to [30, 120] so short edges don't look sharp and long edges
 * don't overshoot.
 */
export function bezierPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const bend = Math.max(30, Math.min(120, Math.hypot(dx, dy) * 0.4));
  const c1: Point = horizontal
    ? { x: a.x + Math.sign(dx) * bend, y: a.y }
    : { x: a.x, y: a.y + Math.sign(dy) * bend };
  const c2: Point = horizontal
    ? { x: b.x - Math.sign(dx) * bend, y: b.y }
    : { x: b.x, y: b.y - Math.sign(dy) * bend };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/**
 * Straight line from `a` to `b`.
 */
export function straightPath(a: Point, b: Point): string {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

/**
 * Orthogonal (right-angle) path from `a` to `b`.
 *
 * Strategy: axis-aligned segments with a single elbow.  We pick the elbow
 * direction that matches the dominant movement axis of the anchor points so
 * the path always exits its source anchor in the same direction as the
 * bezier default would.
 *
 *   horizontal-first (|dx| ≥ |dy|):   a → (mid-x, a.y) → (mid-x, b.y) → b
 *   vertical-first   (|dy| > |dx|):   a → (a.x, mid-y) → (b.x, mid-y) → b
 */
export function orthogonalPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;
  }
  const midY = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
}

/**
 * @deprecated Use `catmullRomPath` for multi-waypoint curves.
 * Kept as a thin wrapper for any direct callers during transition.
 */
export function waypointCurvePath(a: Point, w: Point, b: Point): string {
  return catmullRomPath(a, [w], b);
}

/**
 * Catmull-Rom spline that passes THROUGH every point in:
 *   [src anchor]  →  waypoints[0]  →  …  →  waypoints[N-1]  →  [tgt anchor]
 *
 * Algorithm: Catmull-Rom → cubic Bézier conversion.
 * For each interior segment P[i] → P[i+1] the two cubic control points are:
 *
 *   CP1 = P[i]   + tangent(P[i])   / 3
 *   CP2 = P[i+1] - tangent(P[i+1]) / 3
 *
 * where the tangent at interior point P[k] is:
 *   T[k] = (P[k+1] - P[k-1]) * tension
 *
 * At the boundary endpoints the tangent points directly towards/from the
 * first/last interior neighbour (gives a natural open-ended curve).
 *
 * tension = 0.5 gives the classic centripetal Catmull-Rom feel.
 */
export function catmullRomPath(src: Point, waypoints: Point[], tgt: Point): string {
  // Full ordered point sequence.
  const pts: Point[] = [src, ...waypoints, tgt];
  const n = pts.length;

  // Need at least 2 points to draw anything.
  if (n < 2) return `M ${src.x} ${src.y}`;

  const tension = 0.5;

  // Compute tangents for all points.
  // Boundary tangents point directly to/from the adjacent point.
  const tx: number[] = new Array(n);
  const ty: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tx[i] = (pts[1].x - pts[0].x) * tension;
      ty[i] = (pts[1].y - pts[0].y) * tension;
    } else if (i === n - 1) {
      tx[i] = (pts[n - 1].x - pts[n - 2].x) * tension;
      ty[i] = (pts[n - 1].y - pts[n - 2].y) * tension;
    } else {
      tx[i] = (pts[i + 1].x - pts[i - 1].x) * tension;
      ty[i] = (pts[i + 1].y - pts[i - 1].y) * tension;
    }
  }

  // Build SVG path: M then one cubic Bézier segment per consecutive pair.
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cp1x = p0.x + tx[i] / 3;
    const cp1y = p0.y + ty[i] / 3;
    const cp2x = p1.x - tx[i + 1] / 3;
    const cp2y = p1.y - ty[i + 1] / 3;
    d += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  return d;
}

function fmt(n: number): string {
  // Round to 2 dp to keep SVG compact.
  return String(Math.round(n * 100) / 100);
}

/**
 * Kidney-shaped self-loop anchored on the RIGHT side of the given rect.
 * Used for edges whose source and target are the same node (`D --> D`).
 *
 * The loop starts slightly above the right midpoint, swings out by
 * `~0.7 * rect.height` (clamped to [20, 40]), and comes back slightly
 * below. Always attached to the rect so it stays glued during drags.
 */
export function selfLoopPath(rect: BBox): string {
  const cy = rect.y + rect.height / 2;
  const rightX = rect.x + rect.width;
  const size = Math.max(20, Math.min(40, rect.height * 0.7));
  const start: Point = { x: rightX, y: cy - size * 0.25 };
  const end: Point = { x: rightX, y: cy + size * 0.25 };
  const outX = rightX + size;
  return `M ${start.x} ${start.y} C ${outX} ${cy - size}, ${outX} ${cy + size}, ${end.x} ${end.y}`;
}
