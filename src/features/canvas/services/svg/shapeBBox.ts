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
 * The set of shape tags we know how to measure, scoped to DIRECT children
 * of the node group only. Mermaid always renders the node's own shape as
 * the first direct child, followed by a sibling `<g class="label">` that
 * contains its OWN (often zero-sized) `<rect>` — an unscoped selector like
 * `g.querySelector('rect, ...')` matches that nested label rect instead of
 * the real shape (wrong element, first in document order), producing a
 * near-zero bbox for any node whose shape isn't itself a `<rect>`.
 */
const SHAPE_SELECTOR = ':scope > rect, :scope > polygon, :scope > circle, :scope > ellipse, :scope > path, :scope > .node-bkg';

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
    const fromPoints = polygonPointsBBox(shape.getAttribute('points'));
    if (fromPoints) return fromPoints;
    // Curved shapes (cylinder, stadium caps, rounded corners) have no
    // `points` attribute — only a `d` path string with arc/line commands.
    return pathBBox(shape.getAttribute('d'));
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
 * Minimal SVG path `d` bounding box: walks M/L/H/V/A/Z (and lowercase
 * relative variants) tracking the pen position, expanding bounds at each
 * command's endpoint. Arcs (A/a) — the only curved command Mermaid's
 * built-in node shapes emit, for cylinder caps / rounded corners — are
 * bounded conservatively by expanding the radii around both endpoints
 * rather than solving for the true ellipse extrema; this can slightly
 * over-estimate but never under-estimates, which is what matters for
 * reserving enough layout space. Unsupported commands (bezier curves)
 * stop parsing and return whatever bounds were accumulated so far.
 */
function pathBBox(d: string | null): BBox | null {
  if (!d) return null;
  const tokens = d.match(/[MLHVAZmlhvaz]|-?\d*\.?\d+(?:e-?\d+)?/g);
  if (!tokens) return null;

  let i = 0;
  let cx = 0;
  let cy = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const expand = (x: number, y: number, rx = 0, ry = 0) => {
    minX = Math.min(minX, x - rx);
    maxX = Math.max(maxX, x + rx);
    minY = Math.min(minY, y - ry);
    maxY = Math.max(maxY, y + ry);
  };
  const next = () => parseFloat(tokens[i++]);
  const result = (): BBox | null =>
    minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };

  let cmd = '';
  while (i < tokens.length) {
    if (/^[MLHVAZmlhvaz]$/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': cx = next(); cy = next(); expand(cx, cy); cmd = 'L'; break;
      case 'm': cx += next(); cy += next(); expand(cx, cy); cmd = 'l'; break;
      case 'L': cx = next(); cy = next(); expand(cx, cy); break;
      case 'l': cx += next(); cy += next(); expand(cx, cy); break;
      case 'H': cx = next(); expand(cx, cy); break;
      case 'h': cx += next(); expand(cx, cy); break;
      case 'V': cy = next(); expand(cx, cy); break;
      case 'v': cy += next(); expand(cx, cy); break;
      case 'A':
      case 'a': {
        const rx = next();
        const ry = next();
        next(); // x-axis-rotation
        next(); // large-arc-flag
        next(); // sweep-flag
        const relative = cmd === 'a';
        const ex = relative ? cx + next() : next();
        const ey = relative ? cy + next() : next();
        expand(cx, cy, rx, ry);
        expand(ex, ey, rx, ry);
        cx = ex;
        cy = ey;
        break;
      }
      case 'Z':
      case 'z':
        break;
      default:
        return result();
    }
  }
  return result();
}

/**
 * If the node group's shape child is a `<polygon>` (diamonds, hexagons,
 * parallelograms, trapezoids, etc.), return its vertices in the SVG root's
 * coordinate space. Returns `null` for rectangles/ellipses/circles — those
 * shapes are already faithfully represented by their bbox, so anchor
 * calculation against the bbox is exact.
 *
 * Why this exists: the `anchorOn` heuristic picks the mid-point of one of
 * the bbox's four sides. For a diamond, the bbox's side mid-points sit
 * OUTSIDE the actual outline (the diamond only touches its bbox at 4
 * vertices). Callers use this list to snap the computed anchor onto the
 * true polygon outline.
 */
export function groupPolygon(g: SVGGElement | Element): { x: number; y: number }[] | null {
  const t = parseTranslate(g.getAttribute('transform'));
  const shape = g.querySelector(SHAPE_SELECTOR);
  if (!shape) return null;
  if (shape.tagName !== 'polygon') return null;
  const pointsAttr = shape.getAttribute('points');
  if (!pointsAttr) return null;
  const s = parseTranslate(shape.getAttribute('transform'));
  const nums = pointsAttr.split(/[\s,]+/).map(Number).filter(Number.isFinite);
  if (nums.length < 6) return null; // need at least 3 vertices
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < nums.length; i += 2) {
    out.push({ x: t.x + s.x + nums[i], y: t.y + s.y + nums[i + 1] });
  }
  return out;
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
