/**
 * `routeAllEdges` — the top-level orchestration function that (re)routes
 * every edge in a Mermaid SVG. Idempotent; safe to call every drag frame.
 *
 * Flow (per SVG):
 *   1. Collect every `g[data-node-id]` into a `Map<id, BBox>`.
 *   2. For each `path[data-edge-id]`:
 *        a. Resolve source/target from `data-edge-*` attributes.
 *        b. If either is missing, run geometry-based inference against
 *           the current path endpoints and cache the result on the path.
 *        c. If source === target, emit a self-loop.
 *        d. Otherwise, anchor to closest sides and emit the appropriate
 *           path shape (curve / straight / orthogonal) based on per-edge
 *           line-style and optional waypoints.
 *   3. Re-position edge labels to sit near the new midpoint of each path.
 *
 * The router does NOT read `getBBox()` or call `getTotalLength()` on the
 * critical path — it uses static-attribute helpers from `../svg/*` so it
 * stays fast and jsdom-compatible.
 */
import type { BBox, EdgeLineStyle, EdgeWaypoint, EdgeAnchorOverride } from '@/shared/types/diagram';
import { groupBBox, fallbackBBox, pathEndpoints, pathMidpoint } from '../svg';
import { anchorOn, anchorOnSide, centerOf } from './anchors';
import { bezierPath, straightPath, orthogonalPath, waypointCurvePath, selfLoopPath } from './paths';
import { nearestNodeId } from './endpointInference';

export interface RouteOptions {
  /** Per-edge line style overrides: edgeId → style */
  lineStyles?: ReadonlyMap<string, EdgeLineStyle>;
  /** Per-edge user waypoints: edgeId → list of waypoints */
  waypoints?: ReadonlyMap<string, EdgeWaypoint[]>;
  /**
   * Per-edge anchor overrides: edgeId → { source?, target? }
   * When provided, the auto-computed anchor side is replaced by the
   * user-pinned side + offset.
   */
  anchorOverrides?: ReadonlyMap<string, { source?: EdgeAnchorOverride; target?: EdgeAnchorOverride }>;
}

/**
 * Public entry point. Called after every render and every drag frame.
 * `options` may carry per-edge line style and waypoint data from the stores.
 */
export function routeAllEdges(svg: SVGSVGElement, options: RouteOptions = {}): void {
  const rects = collectNodeRects(svg);
  if (rects.size === 0) return;

  svg.querySelectorAll<SVGPathElement>('path[data-edge-id]').forEach((path) => {
    const id = path.getAttribute('data-edge-id') ?? '';
    const lineStyle = options.lineStyles?.get(id);
    const waypts = options.waypoints?.get(id);
    const anchorOverride = options.anchorOverrides?.get(id);
    routeSingleEdge(path, rects, lineStyle, waypts, anchorOverride);
  });

  repositionEdgeLabels(svg);
}

/**
 * Convenience wrapper used by hooks/components that only have a group
 * element handy (e.g. mid-drag). Consumers should prefer `groupBBox` for
 * new code; kept here for back-compat with `edgeRouter.ts`.
 */
export function nodeRect(g: SVGGElement): BBox | null {
  return groupBBox(g) ?? fallbackBBox(g);
}

// ---------------------------------------------------------------- internals

function collectNodeRects(svg: SVGSVGElement): Map<string, BBox> {
  const out = new Map<string, BBox>();
  svg.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
    const id = g.getAttribute('data-node-id');
    if (!id) return;
    const r = groupBBox(g);
    if (r) out.set(id, r);
  });
  return out;
}

function routeSingleEdge(
  path: SVGPathElement,
  rects: ReadonlyMap<string, BBox>,
  lineStyle: EdgeLineStyle | undefined,
  waypoints: EdgeWaypoint[] | undefined,
  anchorOverride?: { source?: EdgeAnchorOverride; target?: EdgeAnchorOverride },
): void {
  let src = path.getAttribute('data-edge-source');
  let tgt = path.getAttribute('data-edge-target');
  let srcRect = src ? rects.get(src) : undefined;
  let tgtRect = tgt ? rects.get(tgt) : undefined;

  if (!srcRect || !tgtRect) {
    const inferred = inferEndpoints(path, rects, src, tgt);
    if (!inferred) return;
    src = inferred.src;
    tgt = inferred.tgt;
    srcRect = inferred.srcRect;
    tgtRect = inferred.tgtRect;
    // Cache the inference so future frames skip the work.
    path.setAttribute('data-edge-source', src);
    path.setAttribute('data-edge-target', tgt);
  }
  if (!srcRect || !tgtRect) return;

  // Self-loop: draw a small kidney on the right side of the node.
  if (src && tgt && src === tgt) {
    path.setAttribute('d', selfLoopPath(srcRect));
    return;
  }

  // Resolve anchor points: use override if provided, else compute from geometry.
  const a = anchorOverride?.source
    ? anchorOnSide(srcRect, anchorOverride.source)
    : anchorOn(srcRect, centerOf(tgtRect));
  const b = anchorOverride?.target
    ? anchorOnSide(tgtRect, anchorOverride.target)
    : anchorOn(tgtRect, centerOf(srcRect));

  // Choose path shape based on line style.
  const style = lineStyle ?? 'curve';
  if (style === 'straight') {
    path.setAttribute('d', straightPath(a, b));
  } else if (style === 'orthogonal') {
    path.setAttribute('d', orthogonalPath(a, b));
  } else {
    // 'curve' — use waypoint if available, else standard bezier.
    const w = waypoints?.[0];
    path.setAttribute('d', w ? waypointCurvePath(a, w, b) : bezierPath(a, b));
  }
}

function inferEndpoints(
  path: SVGPathElement,
  rects: ReadonlyMap<string, BBox>,
  existingSrc: string | null,
  existingTgt: string | null,
): { src: string; tgt: string; srcRect: BBox; tgtRect: BBox } | null {
  const ends = pathEndpoints(path);
  if (!ends) return null;
  const src = existingSrc ?? nearestNodeId(ends.start, rects);
  const tgt = existingTgt ?? nearestNodeId(ends.end, rects, src ?? undefined);
  if (!src || !tgt) return null;
  const srcRect = rects.get(src);
  const tgtRect = rects.get(tgt);
  if (!srcRect || !tgtRect) return null;
  return { src, tgt, srcRect, tgtRect };
}

function repositionEdgeLabels(svg: SVGSVGElement): void {
  svg.querySelectorAll<SVGGElement>('g.edgeLabel[data-edge-id]').forEach((label) => {
    // Skip placeholder labels Mermaid emits for unlabeled edges — moving
    // them is pointless and litters the DOM.
    if (!(label.textContent ?? '').trim()) return;
    const id = label.getAttribute('data-edge-id');
    if (!id) return;
    const path = svg.querySelector<SVGPathElement>(
      `path[data-edge-id="${cssEscape(id)}"]`,
    );
    if (!path) return;
    const mid = pathMidpoint(path);
    if (!mid) return;
    label.setAttribute('transform', `translate(${mid.x}, ${mid.y})`);
  });
}

function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
