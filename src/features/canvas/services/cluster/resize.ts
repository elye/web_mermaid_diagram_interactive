/**
 * Orchestrator + bbox math for cluster resizing. See the module header in
 * `../../clusterResize.ts` for the full rationale and SVG structure diagram.
 */
import type { BBox } from '@/shared/types/diagram';
import { parseSubgraphMembership } from './subgraphParser';
import { collectClusterElements, collectNodeBBoxes, clusterElementBBox } from './clusterElements';
import { topoOrder } from './topoOrder';

const CLUSTER_PADDING_X = 24; // horizontal padding (each side)
const CLUSTER_PADDING_Y_TOP = 36; // extra space for the label
const CLUSTER_PADDING_Y_BOTTOM = 16;

/**
 * Resize every subgraph cluster in `svg` so it wraps its current member nodes.
 * `source` is the live Mermaid diagram source used to determine membership.
 *
 * @param collapsedClusters  Optional set of cluster ids that are currently
 *   collapsed to a fixed 120×40 box. Collapsed clusters are skipped during
 *   resizing (their box is owned by `useClusterCollapse`), but their current
 *   bbox IS included when sizing parent clusters — so the parent correctly
 *   wraps the collapsed child box.
 *
 * Safe to call on every drag frame — it is fast (pure DOM attribute reads/writes,
 * no layout queries).
 */
export function resizeClusters(
  svg: SVGSVGElement,
  source: string,
  collapsedClusters?: ReadonlySet<string>,
): void {
  const clusterEls = collectClusterElements(svg);
  if (clusterEls.size === 0) return;

  const membership = parseSubgraphMembership(source);
  if (membership.size === 0) return;

  // Collect current VISIBLE node bboxes once per frame.
  // Hidden nodes (collapsed members) are already excluded by collectNodeBBoxes.
  const nodeBBoxes = collectNodeBBoxes(svg);

  // Process clusters bottom-up: deepest nesting level first so parent
  // clusters include already-expanded (or already-collapsed) child bboxes.
  const order = topoOrder(membership);
  for (const subId of order) {
    // Collapsed clusters own their own rect — skip resizing them.
    // Their current bbox (the collapsed 120×40 box) will be picked up by
    // their parent's unionBBox call via clusterEls.
    if (collapsedClusters?.has(subId)) continue;

    const el = clusterEls.get(subId);
    if (!el) continue;
    const members = membership.get(subId);
    if (!members) continue;

    const memberBBox = unionBBox(members, nodeBBoxes, clusterEls, membership);
    if (!memberBBox) continue;

    applyClusterBBox(el, memberBBox);
  }
}

/**
 * Compute the union of all member bboxes for a subgraph, resolving nested
 * sub-subgraphs to their cluster element's current bbox.
 */
function unionBBox(
  members: Set<string>,
  nodeBBoxes: Map<string, BBox>,
  clusterEls: Map<string, SVGGElement>,
  membership: Map<string, Set<string>>,
): BBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  function expand(bbox: BBox) {
    minX = Math.min(minX, bbox.x);
    minY = Math.min(minY, bbox.y);
    maxX = Math.max(maxX, bbox.x + bbox.width);
    maxY = Math.max(maxY, bbox.y + bbox.height);
    found = true;
  }

  for (const id of members) {
    if (membership.has(id)) {
      // It's a nested subgraph — use its current cluster element's bbox.
      const clusterEl = clusterEls.get(id);
      if (clusterEl) {
        const bbox = clusterElementBBox(clusterEl);
        if (bbox) expand(bbox);
      }
    } else {
      const bbox = nodeBBoxes.get(id);
      if (bbox) expand(bbox);
    }
  }

  if (!found) return null;

  return {
    x: minX - CLUSTER_PADDING_X,
    y: minY - CLUSTER_PADDING_Y_TOP,
    width: maxX - minX + CLUSTER_PADDING_X * 2,
    height: maxY - minY + CLUSTER_PADDING_Y_TOP + CLUSTER_PADDING_Y_BOTTOM,
  };
}

/**
 * Rewrite the cluster element's `transform` and inner `<rect>` to match `bbox`.
 * Also moves the label `<g>` to sit at the top-centre of the new box.
 */
function applyClusterBBox(g: SVGGElement, bbox: BBox): void {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;

  g.setAttribute('transform', `translate(${cx}, ${cy})`);

  const rect = g.querySelector<SVGRectElement>(':scope > rect');
  if (rect) {
    rect.setAttribute('x', String(-bbox.width / 2));
    rect.setAttribute('y', String(-bbox.height / 2));
    rect.setAttribute('width', String(bbox.width));
    rect.setAttribute('height', String(bbox.height));
  }

  // Reposition the label group to the top-centre (inside the new rect).
  // Mermaid uses either `g.label` or `g.cluster-label` depending on version.
  const labelG = g.querySelector<SVGGElement>(':scope > g.label, :scope > g.cluster-label');
  if (labelG) {
    // Place label at the top-centre of the cluster, inset by a few pixels.
    const labelX = 0; // centred on the cluster's own origin
    const labelY = -bbox.height / 2 + 14; // just inside the top border
    labelG.setAttribute('transform', `translate(${labelX}, ${labelY})`);

    // Enforce horizontal centering on the text elements.
    // Mermaid may emit text-anchor="start" with a positive x offset; reset both.
    labelG.querySelectorAll<SVGTextElement>('text').forEach((t) => {
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('x', '0');
    });
    labelG.querySelectorAll<SVGTSpanElement>('tspan').forEach((ts) => {
      ts.setAttribute('text-anchor', 'middle');
    });

    // foreignObject (HTML label mode): center it on the cluster origin.
    const fo = labelG.querySelector<SVGForeignObjectElement>('foreignObject');
    if (fo) {
      const foWidth = fo.getAttribute('width');
      if (foWidth) fo.setAttribute('x', String(-Number(foWidth) / 2));
      const inner = fo.querySelector<HTMLElement>('[class*="nodeLabel"], span, div');
      if (inner) inner.style.textAlign = 'center';
    }
  }
}
