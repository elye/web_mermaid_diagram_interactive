/**
 * Geometry helpers: bounding-box math and anchor points.
 */
import type { BBox, Point } from '@/shared/types/diagram';

export function centerOf(bbox: BBox): Point {
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
}

export function translateBBox(bbox: BBox, dx: number, dy: number): BBox {
  return { ...bbox, x: bbox.x + dx, y: bbox.y + dy };
}

/**
 * Pick the anchor point on `from` closest to the center of `to`.
 */
export function anchorTowards(from: BBox, to: BBox): Point {
  const c = centerOf(to);
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = c.x - cx;
  const dy = c.y - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: dx > 0 ? from.x + from.width : from.x, y: cy };
  }
  return { x: cx, y: dy > 0 ? from.y + from.height : from.y };
}

export function cubicPath(a: Point, b: Point): string {
  const dx = (b.x - a.x) * 0.5;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
