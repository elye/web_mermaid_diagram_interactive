/**
 * Base path shape emitters — pure functions from geometry to SVG `d`
 * strings. UI-agnostic; the router picks between them based on the edge's
 * `EdgeLineStyle` and topology.
 *
 * This module owns the primitives (`bezierPath`, `straightPath`,
 * `orthogonalPath`). Multi-waypoint chains live in `./bezierChain` and
 * self-loops in `./selfLoop`.
 */
import type { Point } from '@/shared/types/diagram';
import { bendFor, fmt } from './pathFormat';

/**
 * Smooth cubic Bézier between two anchor points.
 *
 * Control-arm length is proportional to endpoint separation, clamped to
 * a comfortable band by `bendFor`.
 *
 * Optional `srcTangent` / `tgtTangent` are unit outward normals that
 * override the axis-picking heuristic. Supplying them makes the curve
 * leave/enter perpendicular to the anchored side regardless of neighbour
 * position (top/bottom → vertical exit; left/right → horizontal exit).
 */
export function bezierPath(
  a: Point,
  b: Point,
  srcTangent?: Point,
  tgtTangent?: Point,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bend = bendFor(dx, dy);

  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const srcT: Point =
    srcTangent ??
    (horizontal
      ? { x: Math.sign(dx) || 1, y: 0 }
      : { x: 0, y: Math.sign(dy) || 1 });
  const tgtT: Point =
    tgtTangent ??
    (horizontal
      ? { x: -(Math.sign(dx) || 1), y: 0 }
      : { x: 0, y: -(Math.sign(dy) || 1) });

  const c1: Point = { x: a.x + srcT.x * bend, y: a.y + srcT.y * bend };
  const c2: Point = { x: b.x + tgtT.x * bend, y: b.y + tgtT.y * bend };
  return `M ${fmt(a.x)} ${fmt(a.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(b.x)} ${fmt(b.y)}`;
}

/** Straight line from `a` to `b`. */
export function straightPath(a: Point, b: Point): string {
  return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)}`;
}

/**
 * Orthogonal (right-angle) path from `a` to `b` — single elbow chosen
 * to match the dominant movement axis, so the exit direction agrees
 * with `bezierPath`'s default.
 *
 *   horizontal-first (|dx| ≥ |dy|):   a → (mid-x, a.y) → (mid-x, b.y) → b
 *   vertical-first   (|dy| >  |dx|):  a → (a.x, mid-y) → (b.x, mid-y) → b
 */
export function orthogonalPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = (a.x + b.x) / 2;
    return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(midX)} ${fmt(a.y)} L ${fmt(midX)} ${fmt(b.y)} L ${fmt(b.x)} ${fmt(b.y)}`;
  }
  const midY = (a.y + b.y) / 2;
  return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(a.x)} ${fmt(midY)} L ${fmt(b.x)} ${fmt(midY)} L ${fmt(b.x)} ${fmt(b.y)}`;
}
