/**
 * Edge anchor calculation.
 *
 * Given a source rect and a target rect, we want to attach the arrow to
 * ONE of the source rect's four side-midpoints — the one facing the
 * target's center. This is the classic "Manhattan closest-side" heuristic
 * and produces visually clean orthogonal-ish anchors without needing a
 * routing solver.
 */
import type { BBox, Point, EdgeAnchorOverride, AnchorSide } from '@/shared/types/diagram';

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
 * Return an anchor point on `rect` at the user-specified side and offset.
 *
 * `offset` is a fraction [0, 1] along the chosen side:
 *   top/bottom: 0 = left edge, 1 = right edge
 *   left/right: 0 = top edge, 1 = bottom edge
 */
export function anchorOnSide(rect: BBox, override: EdgeAnchorOverride): Point {
  const { side, offset } = override;
  const t = Math.max(0, Math.min(1, offset));
  switch (side as AnchorSide) {
    case 'top':
      return { x: rect.x + rect.width * t, y: rect.y };
    case 'bottom':
      return { x: rect.x + rect.width * t, y: rect.y + rect.height };
    case 'left':
      return { x: rect.x, y: rect.y + rect.height * t };
    case 'right':
      return { x: rect.x + rect.width, y: rect.y + rect.height * t };
  }
}

/**
 * Given a free point on the SVG canvas, snap it to the closest point on the
 * perimeter of `rect` and return the resulting `EdgeAnchorOverride`
 * (side + offset) so it can be persisted in the store.
 */
export function snapToPerimeter(rect: BBox, pt: Point): EdgeAnchorOverride {
  // Distance to each side.
  const distTop = Math.abs(pt.y - rect.y);
  const distBottom = Math.abs(pt.y - (rect.y + rect.height));
  const distLeft = Math.abs(pt.x - rect.x);
  const distRight = Math.abs(pt.x - (rect.x + rect.width));

  const min = Math.min(distTop, distBottom, distLeft, distRight);

  if (min === distTop) {
    return { side: 'top', offset: clamp01((pt.x - rect.x) / rect.width) };
  }
  if (min === distBottom) {
    return { side: 'bottom', offset: clamp01((pt.x - rect.x) / rect.width) };
  }
  if (min === distLeft) {
    return { side: 'left', offset: clamp01((pt.y - rect.y) / rect.height) };
  }
  return { side: 'right', offset: clamp01((pt.y - rect.y) / rect.height) };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Center point of a bbox — handy for readable call sites.
 */
export function centerOf(rect: BBox): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
