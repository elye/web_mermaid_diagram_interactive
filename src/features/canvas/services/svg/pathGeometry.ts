/**
 * SVG path geometry helpers used by the router.
 *
 * We deliberately avoid `getTotalLength()` / `getPointAtLength()` inside
 * jsdom (they are unreliable) — every helper here has a robust fallback
 * that only reads the `d` attribute.
 */
import type { Point } from '@/shared/types/diagram';

/**
 * Read the first and last coordinate pairs out of a path's `d` attribute.
 * The parser is intentionally simple: it walks all signed numbers in `d`
 * and takes the first two as the start point and the last two as the end
 * point. Works for `M x y … L x y`, cubic beziers, and any Mermaid path
 * (every SVG path command ends with an `x, y` pair).
 */
export function pathEndpoints(
  path: SVGPathElement | { getAttribute: (name: string) => string | null },
): { start: Point; end: Point } | null {
  const d = path.getAttribute('d');
  if (!d) return null;
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return null;
  return {
    start: { x: Number(nums[0]), y: Number(nums[1]) },
    end: { x: Number(nums[nums.length - 2]), y: Number(nums[nums.length - 1]) },
  };
}

/**
 * Midpoint of a path. Uses `getPointAtLength(len/2)` in real browsers, and
 * falls back to the midpoint of the straight line between endpoints when
 * that API is unavailable (jsdom) or returns non-finite values.
 */
export function pathMidpoint(path: SVGPathElement): Point | null {
  try {
    const len = path.getTotalLength();
    if (len > 0) {
      const p = path.getPointAtLength(len / 2);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    }
  } catch {
    /* jsdom or non-SVG path — fall through to the analytic midpoint. */
  }
  const ends = pathEndpoints(path);
  if (!ends) return null;
  return { x: (ends.start.x + ends.end.x) / 2, y: (ends.start.y + ends.end.y) / 2 };
}
