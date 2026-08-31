/**
 * compactLayout — re-layouts visible elements into a grid that fits the
 * viewport's aspect ratio.
 *
 * Problem: Mermaid computes positions for fully-expanded subgraphs. After
 * collapse, elements are tiny (120×40) but still at the same coordinates
 * — leaving a very tall, very wide, or generally oddly-shaped layout that
 * doesn't fit on screen. Simply scaling toward centroid preserves the
 * original shape (a tall column stays a tall column).
 *
 * Solution: Compute a fresh grid-based layout that:
 *   1. Reads the viewport (canvas container) aspect ratio.
 *   2. Determines optimal columns/rows to fill a rectangle matching it.
 *   3. Sorts elements to preserve logical flow (top-left → bottom-right
 *      based on original position).
 *   4. Places them in grid cells with appropriate gaps.
 *   5. Returns position overrides (deltas from current positions).
 *
 * This produces a compact rectangular layout that fits the screen well
 * regardless of how the original Mermaid layout was shaped.
 */
import type { PositionOverride } from '@/shared/types/diagram';
import { parseTranslate } from './svg/transforms';
import { extractClusterUserId, clusterElementBBox } from './cluster/clusterElements';
import { collectAllNodeIds } from './cluster/subgraphParser';
import { groupBBox } from './svg';

/** Collapsed cluster box dimensions (must match useClusterCollapse). */
const COLLAPSED_W = 120;
const COLLAPSED_H = 40;

/** Gap between grid cells (px). */
const CELL_GAP_X = 80;
const CELL_GAP_Y = 60;

/** Padding around the entire grid (px). */
const GRID_PADDING = 40;

/** Extra clearance around a packed subgraph block so the cluster's rendered
 *  border (which pads out beyond the raw member bboxes) never touches a
 *  neighboring item. */
const SUBGRAPH_BLOCK_MARGIN = 64;

/** An axis-aligned rectangle described by its center and full size. */
export interface OverlapRect {
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/**
 * True if two axis-aligned rectangles overlap by any amount. This is the
 * single common check used everywhere two components' rectangles need to
 * be compared — both as an internal invariant check while packing (below)
 * and by tests asserting two placed components don't overlap.
 */
export function rectsOverlap(a: OverlapRect, b: OverlapRect): boolean {
  return (
    Math.abs(a.cx - b.cx) < (a.width + b.width) / 2 &&
    Math.abs(a.cy - b.cy) < (a.height + b.height) / 2
  );
}

/** True if ANY pair of `items` (placed at the parallel `positions`) overlap. */
function anyOverlap(
  items: { width: number; height: number }[],
  positions: { cx: number; cy: number }[],
): boolean {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = { cx: positions[i].cx, cy: positions[i].cy, width: items[i].width, height: items[i].height };
      const b = { cx: positions[j].cx, cy: positions[j].cy, width: items[j].width, height: items[j].height };
      if (rectsOverlap(a, b)) return true;
    }
  }
  return false;
}

/**
 * Pack `items` into a grid whose COLUMN WIDTHS / ROW HEIGHTS adapt to the
 * largest item in each column/row (like an HTML table), searching for the
 * column count whose resulting grid aspect ratio best matches `aspect`.
 * Column widths and row heights are what make this overlap-free by
 * construction: two items can never share less space than either needs.
 * Returns each item's target CENTER in local packed-space (origin at the
 * grid's top-left corner) plus the overall packed width/height.
 */
function layoutItemsInGrid(
  items: { width: number; height: number }[],
  aspect: number,
  gapX: number,
  gapY: number,
): { positions: { cx: number; cy: number }[]; width: number; height: number } {
  const n = items.length;
  function layoutForCols(cols: number) {
    const rows = Math.ceil(n / cols);
    const colWidths = new Array(cols).fill(0);
    const rowHeights = new Array(rows).fill(0);
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      colWidths[col] = Math.max(colWidths[col], items[i].width);
      rowHeights[row] = Math.max(rowHeights[row], items[i].height);
    }
    const gridW = colWidths.reduce((s, w) => s + w, 0) + (cols - 1) * gapX;
    const gridH = rowHeights.reduce((s, h) => s + h, 0) + (rows - 1) * gapY;
    return { rows, colWidths, rowHeights, gridW, gridH };
  }

  let bestCols = 1;
  let bestDiff = Infinity;
  let best = layoutForCols(1);
  for (let cols = 1; cols <= n; cols++) {
    const layout = layoutForCols(cols);
    const diff = Math.abs(layout.gridW / layout.gridH - aspect);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestCols = cols;
      best = layout;
    }
  }

  const { rows, colWidths, rowHeights, gridW, gridH } = best;
  const colX: number[] = [];
  for (let c = 0, acc = 0; c < bestCols; c++) { colX.push(acc); acc += colWidths[c] + gapX; }
  const rowY: number[] = [];
  for (let r = 0, acc = 0; r < rows; r++) { rowY.push(acc); acc += rowHeights[r] + gapY; }

  const positions = items.map((_, i) => {
    const col = i % bestCols;
    const row = Math.floor(i / bestCols);
    return { cx: colX[col] + colWidths[col] / 2, cy: rowY[row] + rowHeights[row] / 2 };
  });

  return { positions, width: gridW, height: gridH };
}

/**
 * `layoutItemsInGrid`, but verified against `rectsOverlap`/`anyOverlap`
 * before returning. The grid math already guarantees non-overlap given
 * accurate item sizes, but component footprints are estimates (a
 * subgraph's real rendered border depends on its label text, nested
 * padding, etc.) — so this is the actual enforcement point: if the
 * estimate ever turns out too tight, the gap is grown and the grid is
 * recomputed until every pair of rectangles is verified clear.
 */
function packItemsSafely(
  items: { width: number; height: number }[],
  aspect: number,
): { positions: { cx: number; cy: number }[]; width: number; height: number } {
  let gapX = CELL_GAP_X;
  let gapY = CELL_GAP_Y;
  let result = layoutItemsInGrid(items, aspect, gapX, gapY);
  for (let attempt = 0; attempt < 5 && anyOverlap(items, result.positions); attempt++) {
    gapX *= 1.5;
    gapY *= 1.5;
    result = layoutItemsInGrid(items, aspect, gapX, gapY);
  }
  return result;
}

interface VisibleElement {
  id: string;
  /** Current center x in SVG root coordinates. */
  cx: number;
  /** Current center y in SVG root coordinates. */
  cy: number;
  /** Effective width of this element. */
  width: number;
  /** Effective height of this element. */
  height: number;
  kind: 'node' | 'collapsed-cluster' | 'subgraph-block';
  /** Only set for `subgraph-block`: each DIRECT child component plus its
   *  offset from the block's own center. A child may itself be a
   *  `subgraph-block` (a nested subgraph, already packed into its own
   *  block) — that's what keeps nesting isolated at every depth. */
  members?: { component: VisibleElement; offsetX: number; offsetY: number }[];
}

/** Parse a standalone SVG string into a detached element; all geometry
 *  readers here are attribute-based, so it never needs to be in the DOM. */
function parseNaturalSvg(svgString: string): SVGSVGElement | null {
  if (!svgString) return null;
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svg = doc.documentElement as unknown as SVGSVGElement;
  return svg.nodeName.toLowerCase() === 'svg' ? svg : null;
}

/**
 * A collapsed cluster is only independently visible when none of its
 * ancestors is also collapsed — mirrors the check in `useClusterCollapse`
 * that decides which clusters actually get hidden vs. drawn as a box.
 */
function isTopLevelCollapsed(
  clusterId: string,
  collapsedClusters: ReadonlySet<string>,
  membership: Map<string, Set<string>>,
): boolean {
  for (const [parentId, members] of membership) {
    if (parentId === clusterId) continue;
    if (collapsedClusters.has(parentId) && members.has(clusterId)) return false;
  }
  return true;
}

/**
 * Pack a subgraph's DIRECT child components — plain nodes, nested
 * subgraph-blocks, and top-level collapsed clusters — into a compact
 * square-ish mini-grid, returned as a single `subgraph-block` element so
 * the outer layout treats the whole group as one unit. Because a nested
 * subgraph's own members are already resolved into its own block before
 * this runs (see `resolveComponent`), this only ever arranges DIRECT
 * children — which is what keeps a subgraph's auto-fitted border, at any
 * nesting depth, from ever wrapping around an unrelated component.
 */
function buildSubgraphBlock(groupId: string, children: VisibleElement[]): VisibleElement {
  const sorted = [...children].sort((a, b) => {
    const rowA = Math.round(a.cy / 80);
    const rowB = Math.round(b.cy / 80);
    if (rowA !== rowB) return rowA - rowB;
    return a.cx - b.cx;
  });

  const n = sorted.length;
  const packed = packItemsSafely(sorted, 1);

  const members = sorted.map((component, i) => ({
    component,
    offsetX: packed.positions[i].cx - packed.width / 2,
    offsetY: packed.positions[i].cy - packed.height / 2,
  }));

  return {
    id: groupId,
    cx: sorted.reduce((s, c) => s + c.cx, 0) / n,
    cy: sorted.reduce((s, c) => s + c.cy, 0) / n,
    width: packed.width + SUBGRAPH_BLOCK_MARGIN,
    height: packed.height + SUBGRAPH_BLOCK_MARGIN,
    kind: 'subgraph-block',
    members,
  };
}

/**
 * Compute position overrides that re-layout visible elements into a
 * viewport-fitting rectangular grid.
 *
 * Reads node/cluster positions from `naturalSvg` — the store's pristine,
 * pre-override, pre-collapse SVG string — rather than the live DOM. The
 * live DOM may already carry position overrides and collapse-resized
 * cluster rects from a *previous* re-route; feeding that back in would
 * make each click compound on the last click's grid instead of starting
 * from the same baseline. Reading the pristine source instead makes this
 * a pure function of (source, collapsedClusters, viewportAspect) — same
 * inputs always produce the same overrides, so repeated clicks converge
 * instead of drifting.
 *
 * @param naturalSvg          The diagram store's un-mutated rendered SVG string.
 * @param hiddenNodeIds       Nodes hidden inside collapsed clusters.
 * @param collapsedClusters   Currently collapsed cluster ids.
 * @param membership          Full subgraph containment map.
 * @param viewportAspect      Width/height ratio of the canvas container (default 16:9).
 * @returns Position overrides keyed by node id.
 */
export function computeCompactLayout(
  naturalSvg: string,
  hiddenNodeIds: ReadonlySet<string>,
  collapsedClusters: ReadonlySet<string>,
  membership: Map<string, Set<string>>,
  viewportAspect: number = 16 / 9,
): Record<string, PositionOverride> {
  const overrides: Record<string, PositionOverride> = {};
  const svgEl = parseNaturalSvg(naturalSvg);
  if (!svgEl) return overrides;

  // Every subgraph/node id → its direct parent subgraph id, used to find
  // which ids are ROOTS (not nested inside anything) to resolve from below.
  const parentOf = new Map<string, string>();
  for (const [parentId, members] of membership) {
    for (const memberId of members) parentOf.set(memberId, parentId);
  }

  // Plain node geometry, read once.
  const nodePositions = new Map<string, { cx: number; cy: number; width: number; height: number }>();
  svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
    const id = g.getAttribute('data-node-id')!;
    if (hiddenNodeIds.has(id)) return;
    if (g.style.display === 'none') return;
    const bbox = groupBBox(g);
    if (!bbox) return;
    nodePositions.set(id, {
      cx: bbox.x + bbox.width / 2,
      cy: bbox.y + bbox.height / 2,
      width: bbox.width,
      height: bbox.height,
    });
  });

  // Cluster <g> elements by user id, read once.
  const clusterEls = new Map<string, SVGGElement>();
  svgEl.querySelectorAll<SVGGElement>('g.cluster').forEach((g) => {
    const clusterId = extractClusterUserId(g.getAttribute('id') ?? '');
    if (clusterId) clusterEls.set(clusterId, g);
  });

  // Recursively resolve `id` into a single placeable component: a plain
  // node, a top-level collapsed cluster (one box), or a subgraph-block
  // packing its own DIRECT children (which may themselves be nested
  // subgraph-blocks). Every subgraph packs only its own direct children —
  // never flattening deeper descendants into its own mini-grid — so a
  // component can never end up placed inside a subgraph it doesn't
  // belong to, no matter how deeply nested the diagram is.
  const resolving = new Set<string>();
  function resolveComponent(id: string): VisibleElement | null {
    if (resolving.has(id)) return null; // cycle guard
    if (membership.has(id) && !collapsedClusters.has(id)) {
      resolving.add(id);
      const children: VisibleElement[] = [];
      for (const childId of membership.get(id)!) {
        const child = resolveComponent(childId);
        if (child) children.push(child);
      }
      resolving.delete(id);
      if (children.length === 0) return null;
      if (children.length === 1) return children[0];
      return buildSubgraphBlock(id, children);
    }
    if (collapsedClusters.has(id)) {
      if (!isTopLevelCollapsed(id, collapsedClusters, membership)) return null;
      const g = clusterEls.get(id);
      if (!g) return null;
      const bbox = clusterElementBBox(g);
      if (!bbox) return null;
      return {
        id,
        cx: bbox.x + bbox.width / 2,
        cy: bbox.y + bbox.height / 2,
        width: COLLAPSED_W,
        height: COLLAPSED_H,
        kind: 'collapsed-cluster',
      };
    }
    const pos = nodePositions.get(id);
    return pos ? { id, ...pos, kind: 'node' } : null;
  }

  const candidateIds = new Set<string>([...nodePositions.keys(), ...membership.keys()]);
  const elements: VisibleElement[] = [];
  for (const id of candidateIds) {
    if (parentOf.has(id)) continue; // resolved via its ancestor instead
    const el = resolveComponent(id);
    if (el) elements.push(el);
  }

  // Need at least 2 elements to re-layout.
  if (elements.length < 2) return overrides;

  // ── Sort elements to preserve reading order ────────────────────────────────
  // Sort by original position: primary = row (y), secondary = column (x).
  // This keeps elements that were near each other in the original layout
  // near each other in the grid.
  elements.sort((a, b) => {
    // Quantize Y into rows (within 80px = same row).
    const rowA = Math.round(a.cy / 80);
    const rowB = Math.round(b.cy / 80);
    if (rowA !== rowB) return rowA - rowB;
    return a.cx - b.cx;
  });

  const n = elements.length;

  // ── Pack items into a grid, verified overlap-free by `packItemsSafely` ───
  // A fixed-size shelf (single target row width) breaks down as soon as
  // one item (e.g. a subgraph block) is wide enough to fill a whole row by
  // itself — every other item then gets pushed onto its own row too,
  // degenerating into a single vertical column regardless of aspect ratio.
  // The column/row table search always considers every column count from
  // 1..n, so it can still use width AND height to match the viewport
  // instead of just stacking.
  const packed = packItemsSafely(elements, viewportAspect);

  // Re-center the grid at the centroid of the original layout.
  const centroidX = elements.reduce((s, e) => s + e.cx, 0) / n;
  const centroidY = elements.reduce((s, e) => s + e.cy, 0) / n;
  const shiftX = centroidX - packed.width / 2;
  const shiftY = centroidY - packed.height / 2;

  // Recursively apply a target center to an element: a plain node or
  // collapsed cluster writes overrides directly; a subgraph-block instead
  // recurses into each of its own direct children at their own offset —
  // so nested subgraphs get their own correctly-isolated target too.
  function applyElementOverride(el: VisibleElement, targetCx: number, targetCy: number): void {
    const dx = targetCx - el.cx;
    const dy = targetCy - el.cy;
    if (el.kind === 'node') {
      applyNodeOverride(svgEl, overrides, el.id, dx, dy);
    } else if (el.kind === 'collapsed-cluster') {
      // For collapsed clusters: move all hidden member nodes by the same delta.
      for (const nodeId of collectAllNodeIds(el.id, membership)) {
        applyNodeOverride(svgEl, overrides, nodeId, dx, dy);
      }
    } else {
      for (const member of el.members ?? []) {
        applyElementOverride(member.component, targetCx + member.offsetX, targetCy + member.offsetY);
      }
    }
  }

  // ── Assign each element to its grid cell and compute overrides ───────────
  for (let i = 0; i < n; i++) {
    const targetCx = packed.positions[i].cx + shiftX;
    const targetCy = packed.positions[i].cy + shiftY;
    applyElementOverride(elements[i], targetCx, targetCy);
  }

  return overrides;
}

/** Write a node's position override if it would move by ≥ 5px; reads its
 *  current (pristine) transform from `svgEl` to compute the absolute target. */
function applyNodeOverride(
  svgEl: SVGSVGElement,
  overrides: Record<string, PositionOverride>,
  nodeId: string,
  dx: number,
  dy: number,
): void {
  if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
  const nodeG = svgEl.querySelector<SVGGElement>(`g[data-node-id="${nodeId}"]`);
  if (!nodeG) return;
  const pos = parseTranslate(nodeG.getAttribute('transform'));
  overrides[nodeId] = { x: pos.x + dx, y: pos.y + dy };
}
