/**
 * Edge anchor calculation.
 *
 * Given a source rect and a target rect, we want to attach the arrow to
 * ONE of the source rect's four side-midpoints — the one facing the
 * target's center. This is the classic "Manhattan closest-side" heuristic
 * and produces visually clean orthogonal-ish anchors without needing a
 * routing solver.
 */
import type { BBox, Point } from '@/shared/types/diagram';

/**
 * Return the anchor point on `rect` closest to `toCenter`.
 *
 * Sides are picked by comparing the horizontal vs. vertical distance from
 * the rect center to the target center — whichever is larger wins, and
 * we pick the corresponding side midpoint. This ties (`|dx| === |dy|`)
 * are resolved horizontally, which is the more common case for left-to-
 * right flowcharts.
 */
export function anchorOn(rect: BBox, toCenter: Point): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = toCenter.x - cx;
  const dy = toCenter.y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx > 0 ? rect.x + rect.width : rect.x, y: cy };
  }
  return { x: cx, y: dy > 0 ? rect.y + rect.height : rect.y };
}

/**
 * Center point of a bbox — handy for readable call sites.
 */
export function centerOf(rect: BBox): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
