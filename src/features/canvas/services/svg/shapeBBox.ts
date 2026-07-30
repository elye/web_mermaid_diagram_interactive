/**
 * Compute the axis-aligned bounding box of a Mermaid node shape in the
 * SVG root's coordinate space, purely from static attributes.
 *
 * ## Why not `getBBox()`?
 * - `getBBox()` is broken in jsdom (test env), so relying on it would kill
 *   headless testing.
 * - It also forces a synchronous layout, which we call in a hot loop
 *   (every drag frame on every incident edge).
 *
 * ## Coordinate composition
 * Every Mermaid node group looks like:
 *
 * ```svg
 * <g class="node" transform="translate(gx, gy)">
 *   <polygon transform="translate(sx, sy)" points="…"/>   <!-- for diamonds -->
 * </g>
 * ```
 *
 * Rectangles usually have no inner transform (the rect is pre-centered via
 * negative `x`/`y`), but polygons, hexagons, and some rounded shapes DO
 * carry their own `translate(...)`. Ignoring that inner transform was the
 * root cause of the "hanging arrow" bug on diamond nodes — the returned
 * bbox was off by the polygon's own translate.
 */
import type { BBox } from '@/shared/types/diagram';
import { parseTranslate } from './transforms';

/**
 * The set of shape tags we know how to measure. Order matters — Mermaid
 * often places a decorative `<rect>` before the actual shape, so we take
 * the first match that has real geometry.
 */
const SHAPE_SELECTOR = 'rect, polygon, circle, ellipse, path.node-shape, .node-bkg';

/**
 * BBox of a Mermaid group `<g class="node">` in root SVG coordinates.
 *
 * Returns `null` only when the group has no recognizable shape child;
 * callers may substitute a small fallback rect in that case.
 */
export function groupBBox(g: SVGGElement | Element): BBox | null {
  const t = parseTranslate(g.getAttribute('transform'));
  const shape = g.querySelector(SHAPE_SELECTOR);
  const local = shape ? localBBox(shape) : null;
  if (!local) return null;
  const s = parseTranslate(shape?.getAttribute('transform'));
  return {
    x: t.x + s.x + local.x,
    y: t.y + s.y + local.y,
    width: local.width,
    height: local.height,
  };
}

/**
 * BBox of a shape element in its OWN local coordinate space (before any
 * ancestor transforms are applied). Handles the shape types Mermaid emits.
 */
export function localBBox(shape: Element): BBox | null {
  const tag = shape.tagName;
  if (tag === 'rect') {
    return {
      x: num(shape, 'x'),
      y: num(shape, 'y'),
      width: num(shape, 'width'),
      height: num(shape, 'height'),
    };
  }
  if (tag === 'circle') {
    const cx = num(shape, 'cx');
    const cy = num(shape, 'cy');
    const r = num(shape, 'r');
    return { x: cx - r, y: cy - r, width: r * 2, height: r * 2 };
  }
  if (tag === 'ellipse') {
    const cx = num(shape, 'cx');
    const cy = num(shape, 'cy');
    const rx = num(shape, 'rx');
    const ry = num(shape, 'ry');
    return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
  }
  if (tag === 'polygon' || tag === 'path') {
    return polygonPointsBBox(shape.getAttribute('points'));
  }
  return null;
}

function polygonPointsBBox(pointsAttr: string | null): BBox | null {
  if (!pointsAttr) return null;
  const nums = pointsAttr.split(/[\s,]+/).map(Number).filter(Number.isFinite);
  if (nums.length < 4) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function num(el: Element, attr: string): number {
  return Number(el.getAttribute(attr) ?? '0');
}

/**
 * Fallback box for a node group whose shape child couldn't be measured.
 * A 60x40 rect centered on the group's translate — matches Mermaid's
 * default node size closely enough for routing to remain sensible.
 */
export function fallbackBBox(g: SVGGElement | Element): BBox {
  const t = parseTranslate(g.getAttribute('transform'));
  return { x: t.x - 30, y: t.y - 20, width: 60, height: 40 };
}
