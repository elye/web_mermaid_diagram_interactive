/**
 * DOM readers for cluster `<g>` elements and member node bboxes. These are
 * the only functions in the cluster-resize pipeline that touch the live SVG.
 */
import type { BBox } from '@/shared/types/diagram';
import { groupBBox } from '../svg';
import { parseTranslate } from '../svg/transforms';

/**
 * Return a map of subgraphId → cluster `<g>` element.
 *
 * Mermaid sets the cluster `<g id="flowchart-myId-N">` where N is a counter.
 * We strip the `flowchart-` prefix and the trailing `-<digits>` suffix to
 * recover the user-supplied subgraph id.
 */
export function collectClusterElements(svg: SVGSVGElement): Map<string, SVGGElement> {
  const out = new Map<string, SVGGElement>();
  svg.querySelectorAll<SVGGElement>('g.cluster').forEach((g) => {
    const rawId = g.getAttribute('id') ?? '';
    const userId = extractClusterUserId(rawId);
    if (userId) out.set(userId, g);
  });
  return out;
}

/**
 * Strip Mermaid's `flowchart-` prefix and trailing `-<counter>` suffix.
 * E.g. `flowchart-mySubgraph-7` → `mySubgraph`.
 *
 * Exported so consumers (DiagramCanvas, tests) can share the same logic
 * rather than each maintaining their own copy.
 */
export function extractClusterUserId(rawId: string): string | null {
  // Common Mermaid patterns:
  //   flowchart-<userId>-<n>
  //   graph-<userId>-<n>
  //   <userId>-<n>  (older versions)
  const m =
    /^(?:flowchart|graph|subgraph)-(.+)-\d+$/.exec(rawId) ??
    /^(.+)-\d+$/.exec(rawId);
  return m ? m[1] : rawId || null;
}

/** Collect the current bbox of every visible `g[data-node-id]` in `svg`, keyed by node id.
 * Hidden nodes (display:none) are excluded — they belong to a collapsed cluster and
 * should not influence parent cluster resizing.
 */
export function collectNodeBBoxes(svg: SVGSVGElement): Map<string, BBox> {
  const out = new Map<string, BBox>();
  svg.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
    if (g.style.display === 'none') return; // hidden by cluster collapse
    const id = g.getAttribute('data-node-id');
    if (!id) return;
    const bbox = groupBBox(g);
    if (bbox) out.set(id, bbox);
  });
  return out;
}

/**
 * Return the current bounding box of a cluster element in SVG root coordinates.
 * Derived from its `transform="translate(cx,cy)"` + inner `<rect>` dimensions.
 */
export function clusterElementBBox(g: SVGGElement): BBox | null {
  const t = parseTranslate(g.getAttribute('transform'));
  const rect = g.querySelector<SVGRectElement>(':scope > rect');
  if (!rect) return null;
  const w = Number(rect.getAttribute('width') ?? '0');
  const h = Number(rect.getAttribute('height') ?? '0');
  if (w === 0 && h === 0) return null;
  // Read rect.x / rect.y directly rather than assuming -w/2 / -h/2 centering,
  // so the bbox is correct even when Mermaid uses non-centred coordinates.
  // Fall back to -w/2 / -h/2 when the attributes are absent.
  const rx = Number(rect.getAttribute('x') ?? String(-w / 2));
  const ry = Number(rect.getAttribute('y') ?? String(-h / 2));
  return {
    x: t.x + rx,
    y: t.y + ry,
    width: w,
    height: h,
  };
}
