/**
 * Multi-waypoint Bézier chains with C1 continuity.
 *
 * The router uses `waypointBezierPath` whenever an edge has one or more
 * user-dragged waypoints. Zero-waypoint calls delegate to the simpler
 * `bezierPath` in `./paths` so behaviour is identical for the common case.
 *
 * Algorithm (`chainedBezierPath`):
 *   knots  = [src, w0, w1, …, tgt]
 *   For each interior knot K[i] we compute a shared tangent
 *       T[i] = unit(K[i+1] − K[i-1])          (Catmull-Rom style)
 *   For the endpoints we honour the router-supplied outward normals
 *   (perpendicular to the anchored side) and fall back to the axis-aware
 *   heuristic in `anchorTangent` when no override is available.
 *
 * Because both halves that meet at an interior knot share the SAME
 * tangent direction, their control points lie colinear through K and the
 * joined curve is C1 continuous → visually smooth.
 */
import type { BBox, Point } from '@/shared/types/diagram';
import { bezierPath } from './paths';
import { bendFor, fmt } from './pathFormat';

/**
 * Public router entry point for waypoint-shaped curves.
 *
 * `srcRect` / `tgtRect` are unused by the current algorithm but kept in
 * the signature so callers built before the tangent-aware version don't
 * need to change.
 *
 * @param a           Source anchor point.
 * @param waypoints   Ordered user waypoints between `a` and `b`.
 * @param b           Target anchor point.
 * @param srcTangent  Optional unit outward normal at the source anchor.
 * @param tgtTangent  Optional unit outward normal at the target anchor.
 */
export function waypointBezierPath(
  a: Point,
  waypoints: Point[],
  b: Point,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _srcRect: BBox,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tgtRect: BBox,
  srcTangent?: Point,
  tgtTangent?: Point,
): string {
  if (waypoints.length === 0) return bezierPath(a, b, srcTangent, tgtTangent);
  return chainedBezierPath(a, waypoints, b, srcTangent, tgtTangent);
}

// ---------------------------------------------------------------- internals

function chainedBezierPath(
  src: Point,
  waypoints: Point[],
  tgt: Point,
  srcTangent?: Point,
  tgtTangent?: Point,
): string {
  const knots: Point[] = [src, ...waypoints, tgt];
  const n = knots.length;
  const tan: Point[] = new Array(n);

  // Interior tangents — Catmull-Rom style. Guarantees the two halves
  // that meet at K share this direction → C1 continuity.
  for (let i = 1; i < n - 1; i++) {
    tan[i] = unit(knots[i + 1].x - knots[i - 1].x, knots[i + 1].y - knots[i - 1].y);
  }

  // Endpoint tangents:
  //   src → outgoing direction leaving `src`.
  //   tgt → direction from `tgt` back toward its previous knot (so
  //         cp2 = tgt + tan[n-1]·bend lands correctly in front of tgt).
  tan[0] = srcTangent ?? anchorTangent(knots[0], knots[1]);
  tan[n - 1] = tgtTangent ?? anchorTangent(knots[n - 1], knots[n - 2]);

  let d = `M ${fmt(knots[0].x)} ${fmt(knots[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = knots[i];
    const p1 = knots[i + 1];
    const bend = bendFor(p1.x - p0.x, p1.y - p0.y);

    // cp1 leaves p0 along its outgoing tangent.
    const cp1x = p0.x + tan[i].x * bend;
    const cp1y = p0.y + tan[i].y * bend;

    // cp2 walks backward from p1 along its tangent.
    //   • interior p1: tan[p1] points ~toward `next`; flip to walk back.
    //   • last segment (p1 === tgt): tan[n-1] already points from tgt
    //     toward prev, so we ADD instead of subtract.
    const lastSeg = i + 1 === n - 1;
    const cp2x = p1.x + (lastSeg ? 1 : -1) * tan[i + 1].x * bend;
    const cp2y = p1.y + (lastSeg ? 1 : -1) * tan[i + 1].y * bend;

    d += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  return d;
}

/**
 * Direction used by `bezierPath` to leave anchor `a` heading toward `b`.
 * Returns a unit vector along either the ±x or ±y axis (whichever
 * dominates), matching `bezierPath`'s horizontal-vs-vertical split.
 */
function anchorTangent(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx) || 1, y: 0 };
  return { x: 0, y: Math.sign(dy) || 1 };
}

function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}
