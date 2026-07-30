/**
 * svgManipulator — post-processes a Mermaid-produced SVG string so the
 * rest of the app can treat it as an interactive, addressable scene:
 *
 *   1. Annotate every node group with `data-node-id` (the user's id).
 *   2. Annotate every edge path with `data-edge-id`, `data-edge-source`,
 *      `data-edge-target`.
 *   3. Annotate every edge label with the id of the edge it belongs to
 *      (by position — Mermaid emits labels in the same DOM order as edges).
 *   4. Run an initial `routeAllEdges` + `expandViewBoxToFit` pass so the
 *      diagram is anchor-correct from the very first paint (no visible
 *      jump on first interaction).
 *
 * This module is intentionally thin — the heavy lifting lives in
 * `edgeIds` (id parsing), `svg/*` (geometry), `routing/*` (rerouting),
 * and `viewbox` (fitting). We just glue them together.
 */
import type { NodeMeta, EdgeMeta } from '@/shared/types/diagram';
import { extractUserNodeId, extractEdgeEndpoints } from './edgeIds';
import { groupBBox } from './svg';
import { routeAllEdges } from './routing';
import { expandViewBoxToFit } from './viewbox';

const NODE_CLASS_RE = /(?:^|\s)node(?:\s|$)/;

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Annotate the SVG in-place and return the serialised result. Idempotent —
 * safe to feed its own output back in.
 */
export function annotateInteractiveElements(svgString: string): string {
  const doc = parseSvg(svgString);
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.nodeName.toLowerCase() !== 'svg') return svgString;

  // Never clip content that has been moved outside the original box.
  (svg as unknown as HTMLElement).style.overflow = 'visible';

  const nodeIdSet = annotateNodes(svg);
  const edgeIdsInOrder = annotateEdges(svg, nodeIdSet);
  annotateEdgeLabels(svg, edgeIdsInOrder);

  // Initial routing pass so anchors are already aligned on first paint.
  try {
    routeAllEdges(svg);
    expandViewBoxToFit(svg);
  } catch {
    /* jsdom or malformed svg — DiagramCanvas will retry on mount. */
  }

  return serialize(doc);
}

/**
 * Extract node metadata (id, label text, root-space bbox) for use by
 * the store, drag hook, and any downstream layout systems.
 */
export function extractNodes(svgString: string): NodeMeta[] {
  const doc = parseSvg(svgString);
  const nodes: NodeMeta[] = [];
  doc.querySelectorAll('g[data-node-id]').forEach((g) => {
    const id = g.getAttribute('data-node-id');
    if (!id) return;
    const bbox = groupBBox(g);
    if (!bbox) return;
    const label = (g.querySelector('.nodeLabel, foreignObject, text')?.textContent ?? id).trim();
    nodes.push({ id, label, bbox });
  });
  return nodes;
}

/**
 * Extract edge metadata (id + resolved source/target ids). Missing endpoints
 * are surfaced as `null` — callers may look them up via the geometry
 * fallback in the router if needed.
 */
export function extractEdges(svgString: string): EdgeMeta[] {
  const doc = parseSvg(svgString);
  const edges: EdgeMeta[] = [];
  doc.querySelectorAll('path[data-edge-id]').forEach((p) => {
    const id = p.getAttribute('data-edge-id');
    if (!id) return;
    edges.push({
      id,
      sourceId: p.getAttribute('data-edge-source'),
      targetId: p.getAttribute('data-edge-target'),
    });
  });
  return edges;
}

// ─── Internals ─────────────────────────────────────────────────────────

function parseSvg(svgString: string): Document {
  return new DOMParser().parseFromString(svgString, 'image/svg+xml');
}

function serialize(doc: Document): string {
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/**
 * Tag every `<g class="node">` with `data-node-id` and return the set of
 * unique user-facing ids seen (used to disambiguate edge id parsing).
 */
function annotateNodes(svg: SVGSVGElement): Set<string> {
  const nodeIdSet = new Set<string>();
  const seen = new Set<string>();
  svg.querySelectorAll('g.node, g[class~="node"]').forEach((g) => {
    if (!NODE_CLASS_RE.test(g.getAttribute('class') ?? '')) return;
    const rawId = g.getAttribute('id') ?? '';
    let userId = extractUserNodeId(rawId);
    // Disambiguate collisions that occur in subgraphs.
    if (seen.has(userId)) userId = `${userId}__${seen.size}`;
    seen.add(userId);
    nodeIdSet.add(userId);
    g.setAttribute('data-node-id', userId);
    g.classList.add('mf-node--draggable');
  });
  return nodeIdSet;
}

/**
 * Tag every edge path with `data-edge-id` + `data-edge-source/target`.
 * Returns the ids in DOM order so we can match edge labels positionally.
 */
function annotateEdges(svg: SVGSVGElement, nodeIdSet: ReadonlySet<string>): string[] {
  const paths = svg.querySelectorAll(
    'g.edgePaths > path, path.flowchart-link, path[class*="edge"]',
  );
  const idsInOrder: string[] = [];
  let counter = 0;
  paths.forEach((p) => {
    counter += 1;
    const rawId = p.getAttribute('id') ?? `edge-${counter}`;
    p.setAttribute('data-edge-id', rawId);
    idsInOrder.push(rawId);
    const endpoints = extractEdgeEndpoints(rawId, nodeIdSet);
    if (endpoints) {
      p.setAttribute('data-edge-source', endpoints.source);
      p.setAttribute('data-edge-target', endpoints.target);
    }
  });
  return idsInOrder;
}

/**
 * Mermaid does NOT put an `id` on `g.edgeLabel`, but it emits one
 * label group per edge in the same DOM order as the edge paths — so we
 * link them positionally.
 */
function annotateEdgeLabels(svg: SVGSVGElement, edgeIdsInOrder: readonly string[]): void {
  const labels = svg.querySelectorAll('g.edgeLabels > g.edgeLabel');
  labels.forEach((label, i) => {
    const id = edgeIdsInOrder[i];
    if (id) label.setAttribute('data-edge-id', id);
  });
}
