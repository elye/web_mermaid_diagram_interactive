/**
 * clusterResize — keeps subgraph cluster rectangles wrapped tightly around
 * their member nodes while the user drags.
 *
 * ## Why this module exists
 * Mermaid lays out subgraph clusters (the bounding boxes with labels) once
 * at render time. When the user drags a node, the cluster rect is not
 * automatically updated. This module recomputes each cluster's bounding box
 * from the **current** node positions and resizes the `<rect>` + `translate`
 * in the live SVG, working recursively from the deepest nested subgraph
 * outward so parent clusters always encompass already-resized children.
 *
 * ## SVG structure (Mermaid output)
 *
 * ```svg
 * <g class="clusters">
 *   <g class="cluster" id="flowchart-outerSub-42" transform="translate(cx,cy)">
 *     <rect x="-w/2" y="-h/2" width="w" height="h" />
 *     <g class="label"><text>outerSub</text></g>
 *   </g>
 * </g>
 * <g class="nodes">
 *   <g data-node-id="A" transform="translate(nx,ny)"> … </g>
 * </g>
 * ```
 *
 * Nodes are NOT DOM-children of their cluster — they are siblings in the
 * flat nodes group. Membership is determined by parsing the Mermaid source.
 *
 * ## Coordinate model
 * Every cluster `<g>` carries `transform="translate(cx, cy)"` where (cx, cy)
 * is the **centre** of the cluster.  The inner `<rect>` is pre-centred:
 *   rect.x = −width/2,  rect.y = −height/2
 *
 * To resize we:
 *   1. Compute the union bbox of all member nodes in SVG-root space.
 *   2. Add padding on all sides.
 *   3. Set rect attributes (x/y/width/height) relative to a new centre.
 *   4. Write the new `translate(cx, cy)` on the cluster `<g>`.
 *   5. Reposition the label at the top centre of the cluster.
 */

import type { BBox } from '@/shared/types/diagram';
import { groupBBox } from './svg';
import { parseTranslate } from './svg/transforms';

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Resize every subgraph cluster in `svg` so it wraps its current member nodes.
 * `source` is the live Mermaid diagram source used to determine membership.
 *
 * Safe to call on every drag frame — it is fast (pure DOM attribute reads/writes,
 * no layout queries).
 */
export function resizeClusters(svg: SVGSVGElement, source: string): void {
  const clusterEls = collectClusterElements(svg);
  if (clusterEls.size === 0) return;

  const membership = parseSubgraphMembership(source);
  if (membership.size === 0) return;

  // Collect current node bboxes once per frame.
  const nodeBBoxes = collectNodeBBoxes(svg);

  // Process clusters bottom-up: deepest nesting level first so parent
  // clusters include already-expanded child cluster bboxes.
  const order = topoOrder(membership);
  for (const subId of order) {
    const el = clusterEls.get(subId);
    if (!el) continue;
    const members = membership.get(subId);
    if (!members) continue;

    const memberBBox = unionBBox(members, nodeBBoxes, clusterEls, membership);
    if (!memberBBox) continue;

    applyClusterBBox(el, memberBBox);
  }
}

// ─── Source parsing ────────────────────────────────────────────────────────────

/**
 * Parse Mermaid flowchart/graph source and return a map of
 *   subgraphId → Set<memberIds>
 * where memberIds includes both plain node ids and nested subgraph ids.
 *
 * Handles arbitrarily deep nesting by maintaining a stack of open subgraphs.
 *
 * Only flowchart / graph diagrams use `subgraph` syntax. For other diagram
 * types the function returns an empty map (no-op).
 */
export function parseSubgraphMembership(source: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const stack: string[] = []; // stack of open subgraph ids (innermost last)

  const lines = source.split('\n');
  for (const raw of lines) {
    const line = raw.trim();

    // `subgraph [id] [title]`  — three forms:
    //   subgraph myId[My Title]
    //   subgraph myId
    //   subgraph   (anonymous — Mermaid auto-generates an id)
    const subgraphMatch =
      /^subgraph\s+([A-Za-z0-9_\-"]+)\s*(?:\[.*\])?/.exec(line) ??
      /^subgraph\s*$/.exec(line);
    if (subgraphMatch) {
      // Extract id: first capture group if present, else use a generated placeholder.
      const rawId = subgraphMatch[1]?.replace(/^"|"$/g, '') ?? `__anon_${result.size}`;
      result.set(rawId, new Set());
      // If there is an enclosing subgraph, register this sub as a member.
      if (stack.length > 0) {
        result.get(stack[stack.length - 1])!.add(rawId);
      }
      stack.push(rawId);
      continue;
    }

    if (/^end\s*$/.test(line) || /^end\b/.test(line)) {
      stack.pop();
      continue;
    }

    // Only collect node references when inside at least one subgraph.
    if (stack.length === 0) continue;

    const currentSub = stack[stack.length - 1];

    // Edge declaration lines: `A --> B`, `A -->|label| B`, `A & B --> C`, etc.
    // We just want every identifier that appears as a standalone word.
    const nodeIds = extractNodeIds(line);
    for (const nid of nodeIds) {
      result.get(currentSub)!.add(nid);
    }
  }

  return result;
}

/**
 * Extract all node identifiers from a single line of Mermaid source.
 * This is intentionally broad — it picks up node ids from edge declarations
 * (`A --> B --> C`) and standalone declarations (`A[label]`).
 * Keywords and punctuation are filtered out.
 */
function extractNodeIds(line: string): string[] {
  // Strip inline labels: A[My Label] → A, A{diamond} → A, A((circle)) → A
  const stripped = line
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '');

  // Tokenise by whitespace and common edge decorators.
  const tokens = stripped.split(/[\s\-|>&<]+/);
  const KEYWORDS = new Set([
    '', 'graph', 'flowchart', 'LR', 'RL', 'TD', 'TB', 'BT',
    'subgraph', 'end', 'direction', 'click', 'style', 'classDef',
    'class', 'linkStyle', 'note', 'participant', 'actor', 'loop',
    'alt', 'else', 'opt', 'par', 'and', 'critical', 'option', 'break',
  ]);
  return tokens.filter((t) => t.length > 0 && !KEYWORDS.has(t) && /^[A-Za-z0-9_\-"]+$/.test(t));
}

// ─── Cluster element collection ────────────────────────────────────────────────

/**
 * Return a map of subgraphId → cluster `<g>` element.
 *
 * Mermaid sets the cluster `<g id="flowchart-myId-N">` where N is a counter.
 * We strip the `flowchart-` prefix and the trailing `-<digits>` suffix to
 * recover the user-supplied subgraph id.
 */
function collectClusterElements(svg: SVGSVGElement): Map<string, SVGGElement> {
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
 */
function extractClusterUserId(rawId: string): string | null {
  // Common Mermaid patterns:
  //   flowchart-<userId>-<n>
  //   graph-<userId>-<n>
  //   <userId>-<n>  (older versions)
  const m =
    /^(?:flowchart|graph|subgraph)-(.+)-\d+$/.exec(rawId) ??
    /^(.+)-\d+$/.exec(rawId);
  return m ? m[1] : rawId || null;
}

// ─── Node bbox collection ──────────────────────────────────────────────────────

function collectNodeBBoxes(svg: SVGSVGElement): Map<string, BBox> {
  const out = new Map<string, BBox>();
  svg.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
    const id = g.getAttribute('data-node-id');
    if (!id) return;
    const bbox = groupBBox(g);
    if (bbox) out.set(id, bbox);
  });
  return out;
}

// ─── Topological ordering ─────────────────────────────────────────────────────

/**
 * Return subgraph ids in bottom-up order (leaf subgraphs first, root last).
 * Uses a simple post-order DFS over the subgraph containment tree.
 */
function topoOrder(membership: Map<string, Set<string>>): string[] {
  // Build: child → parent  (a subgraph id that appears as a member of another)
  const childSubgraphs = new Set<string>();
  for (const members of membership.values()) {
    for (const m of members) {
      if (membership.has(m)) childSubgraphs.add(m);
    }
  }
  const roots = [...membership.keys()].filter((id) => !childSubgraphs.has(id));

  const order: string[] = [];
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const members = membership.get(id) ?? new Set();
    for (const m of members) {
      if (membership.has(m)) visit(m); // recurse into nested subgraph first
    }
    order.push(id); // post-order: push after children
  }

  for (const root of roots) visit(root);
  // Any unreachable subgraphs (detached, shouldn't happen in valid Mermaid)
  for (const id of membership.keys()) visit(id);

  return order; // leaf → root
}

// ─── BBox union ───────────────────────────────────────────────────────────────

const CLUSTER_PADDING_X = 24; // horizontal padding (each side)
const CLUSTER_PADDING_Y_TOP = 36; // extra space for the label
const CLUSTER_PADDING_Y_BOTTOM = 16;

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
 * Return the current bounding box of a cluster element in SVG root coordinates.
 * Derived from its `transform="translate(cx,cy)"` + inner `<rect>` dimensions.
 */
function clusterElementBBox(g: SVGGElement): BBox | null {
  const t = parseTranslate(g.getAttribute('transform'));
  const rect = g.querySelector<SVGRectElement>(':scope > rect');
  if (!rect) return null;
  const w = Number(rect.getAttribute('width') ?? '0');
  const h = Number(rect.getAttribute('height') ?? '0');
  if (w === 0 && h === 0) return null;
  // rect.x and rect.y are centred offsets (negative halves).
  return {
    x: t.x - w / 2,
    y: t.y - h / 2,
    width: w,
    height: h,
  };
}

// ─── Apply resize ─────────────────────────────────────────────────────────────

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
  }
}
