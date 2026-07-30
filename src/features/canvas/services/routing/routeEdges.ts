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
 *        d. Otherwise, anchor to closest sides and emit a bezier.
 *   3. Re-position edge labels to sit near the new midpoint of each path.
 *
 * The router does NOT read `getBBox()` or call `getTotalLength()` on the
 * critical path — it uses static-attribute helpers from `../svg/*` so it
 * stays fast and jsdom-compatible.
 */
import type { BBox } from '@/shared/types/diagram';
import { groupBBox, fallbackBBox, pathEndpoints, pathMidpoint } from '../svg';
import { anchorOn, centerOf } from './anchors';
import { bezierPath, selfLoopPath } from './paths';
import { nearestNodeId } from './endpointInference';

/**
 * Public entry point. Called after every render and every drag frame.
 */
export function routeAllEdges(svg: SVGSVGElement): void {
  const rects = collectNodeRects(svg);
  if (rects.size === 0) return;

  svg.querySelectorAll<SVGPathElement>('path[data-edge-id]').forEach((path) => {
    routeSingleEdge(path, rects);
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

  const a = anchorOn(srcRect, centerOf(tgtRect));
  const b = anchorOn(tgtRect, centerOf(srcRect));
  path.setAttribute('d', bezierPath(a, b));
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
