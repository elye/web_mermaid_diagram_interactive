/**
 * Fallback endpoint inference for edge paths.
 *
 * `svgManipulator` normally decodes source/target node ids from Mermaid's
 * edge-id convention (`L-<source>-<target>-<n>`) and stamps them as
 * `data-edge-source` / `data-edge-target`. When that decoding fails —
 * usually because Mermaid emitted an id in an unrecognised format — we
 * fall back to *geometry*: pick the node whose center is closest to the
 * path's current start point as the source, and the node closest to the
 * end point (excluding the source) as the target.
 *
 * This module owns the "nearest node" search. It is pure geometry and
 * safe to unit-test without a DOM.
 */
import type { BBox } from '@/shared/types/diagram';
import { centerOf } from './anchors';

interface HasEndpoint {
  x: number;
  y: number;
}

/**
 * Return the id of the node whose center is closest to `p`, optionally
 * excluding an id (used to prevent the source and target from coinciding
 * except for genuine self-loops, which are handled separately).
 */
export function nearestNodeId(
  p: HasEndpoint,
  rects: ReadonlyMap<string, BBox>,
  exclude?: string,
): string | null {
  let bestId: string | null = null;
  let bestDist = Infinity;
  rects.forEach((r, id) => {
    if (id === exclude) return;
    const c = centerOf(r);
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  });
  return bestId;
}
