/**
 * edgeRouter
 * ----------
 * Robust edge (re)routing that runs after every Mermaid render and after
 * every user drag. Independent of the SVG generator's own path output, so
 * moving *or* adding nodes never leaves edges dangling.
 *
 * Strategy
 * --------
 *  1. For every node group, read its "effective center" — the translate()
 *     offset plus the child shape's local bounding box (read from static
 *     attributes; never `getBBox()`, which is unreliable in jsdom and slow).
 *  2. For every edge path, look up its source & target node from the
 *     `data-edge-source` / `data-edge-target` attributes we set at annotate
 *     time. Anchor the endpoints to the nearest side of each node's bbox
 *     (Manhattan-style closest-side), then draw a cubic bezier.
 *  3. Also update the arrowhead marker if present.
 *
 * Called in three places:
 *  - annotateInteractiveElements() → initial router pass after render.
 *  - useNodeDrag pointerMove → live re-route as the pointer moves.
 *  - DiagramCanvas position-override effect → after any hydration/undo.
 */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Compute the effective rectangle of a node group in the SVG root's coordinate
 * space, respecting BOTH the group's `transform="translate(x,y)"` (which may
 * reflect a user drag) AND the shape child's own transform (which Mermaid uses
 * to center non-rectangular shapes like diamonds and hexagons).
 *
 * Example — a diamond node emitted by Mermaid looks like:
 *   <g class="node" transform="translate(305, 174)">
 *     <polygon transform="translate(-73, 73)" points="73,0 147,-73 73,-147 0,-73" />
 *   </g>
 * The polygon's local right-vertex is (147, -73), but its ROOT-SPACE position
 * is 305 + (-73) + 147, 174 + 73 + (-73) = (378, 174). If we ignore the shape
 * transform we get (452, 100) which is well outside the diamond — the arrow
 * endpoint appears to float in mid-air.
 */
export function nodeRect(g: SVGGElement): Rect | null {
  const t = parseTranslate(g.getAttribute('transform'));
  const shape = g.querySelector<SVGGraphicsElement>(
    'rect, polygon, circle, ellipse, path.node-shape, .node-bkg',
  );
  const local = shape ? localRect(shape) : null;
  if (!local) {
    // Fallback: 60x40 box centered on translate origin.
    return { x: t.x - 30, y: t.y - 20, width: 60, height: 40 };
  }
  // Compose the shape's own transform on top of the group transform.
  const shapeT = shape ? parseTranslate(shape.getAttribute('transform')) : { x: 0, y: 0 };
  return {
    x: t.x + shapeT.x + local.x,
    y: t.y + shapeT.y + local.y,
    width: local.width,
    height: local.height,
  };
}

/**
 * Anchor a point on `from` on the side closest to `toCenter`.
 * "Sides" are top/right/bottom/left midpoints — simple but visually clean.
 */
export function anchorOn(rect: Rect, toCenter: Point): Point {
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
 * Cubic bezier path between two points, with control points offset in the
 * direction the edge is leaving each anchor. Produces smooth L/R & T/B curves.
 */
export function bezierPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const bend = Math.max(30, Math.min(120, Math.hypot(dx, dy) * 0.4));
  const c1: Point = horizontal ? { x: a.x + Math.sign(dx) * bend, y: a.y } : { x: a.x, y: a.y + Math.sign(dy) * bend };
  const c2: Point = horizontal ? { x: b.x - Math.sign(dx) * bend, y: b.y } : { x: b.x, y: b.y - Math.sign(dy) * bend };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/**
 * (Re)route every edge in the SVG. Idempotent — safe to call as often as needed.
 *
 * For each edge we first look up its `data-edge-source` / `data-edge-target`
 * attributes (populated at annotate time). If either is missing OR the
 * referenced node isn't in the SVG, we fall back to inferring endpoints
 * from the edge's own path geometry: the closest node to the path's start
 * point becomes the source; the closest node to the end point becomes the
 * target. This guarantees edges never get stranded even when Mermaid changes
 * its id conventions in a future release.
 */
export function routeAllEdges(svg: SVGSVGElement): void {
  const nodes = svg.querySelectorAll<SVGGElement>('g[data-node-id]');
  const rects = new Map<string, Rect>();
  nodes.forEach((g) => {
    const id = g.getAttribute('data-node-id')!;
    const r = nodeRect(g);
    if (r) rects.set(id, r);
  });
  // Note: we DON'T short-circuit on rects.size < 2 — a diagram with a single
  // self-loop (`D --> D`) is legal and needs routing too.
  if (rects.size === 0) return;

  const edges = svg.querySelectorAll<SVGPathElement>('path[data-edge-id]');
  edges.forEach((path) => {
    let src = path.getAttribute('data-edge-source');
    let tgt = path.getAttribute('data-edge-target');
    let srcRect = src ? rects.get(src) : undefined;
    let tgtRect = tgt ? rects.get(tgt) : undefined;

    // Fallback: infer endpoints from the path's current geometry.
    if (!srcRect || !tgtRect) {
      const ends = pathEndpoints(path);
      if (!ends) return;
      if (!srcRect) {
        src = nearestNodeId(ends.start, rects);
        srcRect = src ? rects.get(src) : undefined;
      }
      if (!tgtRect) {
        tgt = nearestNodeId(ends.end, rects, src ?? undefined);
        tgtRect = tgt ? rects.get(tgt) : undefined;
      }
      if (src && tgt) {
        // Cache the inference so subsequent frames don't repeat the work.
        path.setAttribute('data-edge-source', src);
        path.setAttribute('data-edge-target', tgt);
      }
    }
    if (!srcRect || !tgtRect) return;

    // Self-loop (e.g. `D --> D`): draw a small kidney-shaped loop on the
    // right side of the node so it stays visibly attached after drags.
    if (src && tgt && src === tgt) {
      path.setAttribute('d', selfLoopPath(srcRect));
      return;
    }

    const tgtCenter = center(tgtRect);
    const srcCenter = center(srcRect);
    const a = anchorOn(srcRect, tgtCenter);
    const b = anchorOn(tgtRect, srcCenter);
    path.setAttribute('d', bezierPath(a, b));
  });

  // Also move any edge labels to sit near the midpoint of their new path.
  // Skip empty labels — those are placeholder groups Mermaid emits for
  // unlabeled edges, and moving them accomplishes nothing.
  const labels = svg.querySelectorAll<SVGGElement>('g.edgeLabel[data-edge-id]');
  labels.forEach((label) => {
    if (!(label.textContent ?? '').trim()) return;
    const id = label.getAttribute('data-edge-id')!;
    const path = svg.querySelector<SVGPathElement>(`path[data-edge-id="${cssEscape(id)}"]`);
    if (!path) return;
    const mid = pathMidpoint(path);
    if (!mid) return;
    label.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
  });
}

/**
 * Draw a small self-loop on the right of `rect`. Anchored just above and
 * just below the right-mid, curving out and back — visually the same
 * kidney-shape Mermaid produces, but always attached to the (possibly
 * dragged) node.
 */
function selfLoopPath(rect: Rect): string {
  const cy = rect.y + rect.height / 2;
  const rightX = rect.x + rect.width;
  const size = Math.max(20, Math.min(40, rect.height * 0.7));
  const start: Point = { x: rightX, y: cy - size * 0.25 };
  const end: Point = { x: rightX, y: cy + size * 0.25 };
  const outX = rightX + size;
  return `M ${start.x} ${start.y} C ${outX} ${cy - size}, ${outX} ${cy + size}, ${end.x} ${end.y}`;
}

/**
 * Midpoint of a path. In real browsers we use `getPointAtLength(len/2)`;
 * in jsdom (used by tests) both `getTotalLength` and `getPointAtLength`
 * are unreliable, so fall back to parsing the `d` attribute directly.
 */
function pathMidpoint(path: SVGPathElement): Point | null {
  try {
    const len = path.getTotalLength();
    if (len > 0) {
      const p = path.getPointAtLength(len / 2);
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) return { x: p.x, y: p.y };
    }
  } catch {
    /* jsdom */
  }
  const ends = pathEndpoints(path);
  if (!ends) return null;
  return { x: (ends.start.x + ends.end.x) / 2, y: (ends.start.y + ends.end.y) / 2 };
}

/**
 * Expand the SVG's viewBox (and width/height) to comfortably contain every
 * (possibly user-dragged) node. Called after `routeAllEdges`.
 */
export function expandViewBoxToFit(svg: SVGSVGElement, padding = 40): void {
  const nodes = svg.querySelectorAll<SVGGElement>('g[data-node-id]');
  if (nodes.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((g) => {
    const r = nodeRect(g);
    if (!r) return;
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  });

  if (!isFinite(minX)) return;

  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  // Clear any max-width mermaid may have set inline.
  (svg as unknown as HTMLElement).style.maxWidth = 'none';
}

function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * Read the first and last coordinate pairs out of a path's `d` attribute.
 * Handles Mermaid's typical "M x y ... L x y" or bezier chains.
 */
function pathEndpoints(path: SVGPathElement): { start: Point; end: Point } | null {
  const d = path.getAttribute('d');
  if (!d) return null;
  // Extract all numeric pairs. Path commands are letters; we ignore them
  // and just walk numbers — the first pair is the move-to, the last pair
  // is the final point (since every SVG path command ends with x,y).
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 4) return null;
  const start: Point = { x: Number(nums[0]), y: Number(nums[1]) };
  const end: Point = {
    x: Number(nums[nums.length - 2]),
    y: Number(nums[nums.length - 1]),
  };
  return { start, end };
}

function nearestNodeId(
  p: Point,
  rects: Map<string, Rect>,
  exclude?: string,
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  rects.forEach((r, id) => {
    if (id === exclude) return;
    const c = center(r);
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  });
  return bestId;
}

function parseTranslate(transform: string | null): Point {
  if (!transform) return { x: 0, y: 0 };
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}

function localRect(shape: SVGGraphicsElement): Rect | null {
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
    // Mermaid emits polygon points in local coords. Parse min/max.
    const pts = shape.getAttribute('points') ?? '';
    const nums = pts.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    if (nums.length >= 4) {
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
  }
  return null;
}

function num(el: Element, attr: string): number {
  return Number(el.getAttribute(attr) ?? '0');
}

function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
