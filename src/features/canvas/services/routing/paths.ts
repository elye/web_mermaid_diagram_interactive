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
 * Smooth cubic bezier routed through a single user-dragged waypoint `w`.
 *
 * Uses Catmull-Rom → cubic Bézier conversion so the curve passes through
 * all three points (a, w, b) with a continuous tangent at `w` — no kink.
 *
 * The tangent at the interior point `w` is the vector from `a` to `b`
 * scaled by the Catmull-Rom tension (α = 0.5 gives centripetal CR).
 * The two cubic segments share that tangent so the junction is C1.
 *
 * For the boundary points we use a phantom "virtual" control point by
 * reflecting: the tangent at `a` points toward `w`, and at `b` away from `w`.
 */
export function waypointCurvePath(a: Point, w: Point, b: Point): string {
  // Catmull-Rom tension (0.5 = centripetal, feels natural for drag handles).
  const alpha = 0.5;

  // Tangent at interior waypoint w: proportional to (b - a).
  const twx = (b.x - a.x) * alpha;
  const twy = (b.y - a.y) * alpha;

  // Tangent at start a: pointing toward w (half of a→w vector).
  const tax = (w.x - a.x) * alpha;
  const tay = (w.y - a.y) * alpha;

  // Tangent at end b: pointing away from w (half of w→b vector).
  const tbx = (b.x - w.x) * alpha;
  const tby = (b.y - w.y) * alpha;

  // Segment 1: a → w
  // Cubic control points: (a + tax/3, w - twx/3)
  const c1x = a.x + tax / 3;
  const c1y = a.y + tay / 3;
  const c2x = w.x - twx / 3;
  const c2y = w.y - twy / 3;

  // Segment 2: w → b
  // Cubic control points: (w + twx/3, b - tbx/3)
  const c3x = w.x + twx / 3;
  const c3y = w.y + twy / 3;
  const c4x = b.x - tbx / 3;
  const c4y = b.y - tby / 3;

  return (
    `M ${a.x} ${a.y} ` +
    `C ${c1x} ${c1y}, ${c2x} ${c2y}, ${w.x} ${w.y} ` +
    `C ${c3x} ${c3y}, ${c4x} ${c4y}, ${b.x} ${b.y}`
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
