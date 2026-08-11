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
  kind: 'node' | 'collapsed-cluster';
}

/**
 * Compute position overrides that re-layout visible elements into a
 * viewport-fitting rectangular grid.
 *
 * @param svgEl              The live SVG element (with collapse already applied).
 * @param hiddenNodeIds      Nodes hidden inside collapsed clusters.
 * @param collapsedClusters  Currently collapsed cluster ids.
 * @param membership         Full subgraph containment map.
 * @param viewportAspect     Width/height ratio of the canvas container (default 16:9).
 * @returns Position overrides keyed by node id.
 */
export function computeCompactLayout(
  svgEl: SVGSVGElement,
  hiddenNodeIds: ReadonlySet<string>,
  collapsedClusters: ReadonlySet<string>,
  membership: Map<string, Set<string>>,
  viewportAspect: number = 16 / 9,
): Record<string, PositionOverride> {
  const overrides: Record<string, PositionOverride> = {};
  const elements: VisibleElement[] = [];

  // ── Collect visible nodes ──────────────────────────────
  svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
    const id = g.getAttribute('data-node-id')!;
    if (hiddenNodeIds.has(id)) return;
    if (g.style.display === 'none') return;

    const bbox = groupBBox(g);
    if (!bbox) return;

    elements.push({
      id,
      cx: bbox.x + bbox.width / 2,
      cy: bbox.y + bbox.height / 2,
      width: bbox.width,
      height: bbox.height,
      kind: 'node',
    });
  });

  // ── Collect collapsed clusters ────────────────────────
  svgEl.querySelectorAll<SVGGElement>('g.cluster').forEach((g) => {
    const rawId = g.getAttribute('id') ?? '';
    const clusterId = extractClusterUserId(rawId);
    if (!clusterId || !collapsedClusters.has(clusterId)) return;

    const bbox = clusterElementBBox(g);
    if (!bbox) return;

    elements.push({
      id: clusterId,
      cx: bbox.x + bbox.width / 2,
      cy: bbox.y + bbox.height / 2,
      width: COLLAPSED_W,
      height: COLLAPSED_H,
      kind: 'collapsed-cluster',
    });
  });

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

  // ── Compute grid dimensions ────────────────────────────────────
  const n = elements.length;
  const maxW = Math.max(...elements.map((e) => e.width));
  const maxH = Math.max(...elements.map((e) => e.height));
  const cellW = maxW + CELL_GAP_X;
  const cellH = maxH + CELL_GAP_Y;

  // Find the number of columns that makes the grid aspect ratio closest
  // to the viewport aspect ratio.
  // Grid width  = cols * cellW
  // Grid height = rows * cellH, where rows = ceil(n / cols)
  // We want (cols * cellW) / (rows * cellH) ≈ viewportAspect
  let bestCols = 1;
  let bestAspectDiff = Infinity;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const gridW = cols * cellW;
    const gridH = rows * cellH;
    const aspect = gridW / gridH;
    const diff = Math.abs(aspect - viewportAspect);
    if (diff < bestAspectDiff) {
      bestAspectDiff = diff;
      bestCols = cols;
    }
  }

  const cols = bestCols;
  const rows = Math.ceil(n / cols);

  // ── Compute grid positions (centers of each cell) ──────────────────────────
  // Grid origin: center the grid at the centroid of the original layout.
  const centroidX = elements.reduce((s, e) => s + e.cx, 0) / n;
  const centroidY = elements.reduce((s, e) => s + e.cy, 0) / n;

  const gridW = (cols - 1) * cellW;
  const gridH = (rows - 1) * cellH;
  const gridOriginX = centroidX - gridW / 2;
  const gridOriginY = centroidY - gridH / 2;

  // ── Assign each element to a grid cell and compute overrides ───────────────
  for (let i = 0; i < n; i++) {
    const el = elements[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const targetCx = gridOriginX + col * cellW;
    const targetCy = gridOriginY + row * cellH;

    const dx = targetCx - el.cx;
    const dy = targetCy - el.cy;

    // Skip if already close enough (< 5px).
    if (Math.abs(dx) < 5 && Math.abs(dy) < 5) continue;

    if (el.kind === 'node') {
      const nodeG = svgEl.querySelector<SVGGElement>(
        `g[data-node-id="${el.id}"]`,
      );
      if (nodeG) {
        const pos = parseTranslate(nodeG.getAttribute('transform'));
        overrides[el.id] = { x: pos.x + dx, y: pos.y + dy };
      }
    } else {
      // For collapsed clusters: move all hidden member nodes by the same delta.
      const memberIds = collectAllNodeIds(el.id, membership);
      for (const nodeId of memberIds) {
        const nodeG = svgEl.querySelector<SVGGElement>(
          `g[data-node-id="${nodeId}"]`,
        );
        if (!nodeG) continue;
        const pos = parseTranslate(nodeG.getAttribute('transform'));
        overrides[nodeId] = { x: pos.x + dx, y: pos.y + dy };
      }
    }
  }

  return overrides;
}
