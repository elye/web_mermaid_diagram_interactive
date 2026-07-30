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
 * Cubic bezier routed through a single user-dragged waypoint `w`.
 *
 * Two separate cubic segments are stitched so the path is C1-continuous
 * at the waypoint: a→w→b.  Each segment uses a simple "pull toward
 * waypoint" heuristic for control points.
 */
export function waypointCurvePath(a: Point, w: Point, b: Point): string {
  // Control points for segment a→w: pull from both ends towards the waypoint.
  const c1ax = a.x + (w.x - a.x) * 0.5;
  const c1ay = a.y + (w.y - a.y) * 0.5;
  // Control points for segment w→b.
  const c2bx = w.x + (b.x - w.x) * 0.5;
  const c2by = w.y + (b.y - w.y) * 0.5;
  return (
    `M ${a.x} ${a.y} ` +
    `C ${c1ax} ${c1ay}, ${w.x} ${w.y}, ${w.x} ${w.y} ` +
    `C ${w.x} ${w.y}, ${c2bx} ${c2by}, ${b.x} ${b.y}`
  );
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
