/**
 * Path shape emitters — pure functions from geometry to SVG `d` strings.
 * Kept UI-agnostic: routers may pick between these based on edge topology.
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
