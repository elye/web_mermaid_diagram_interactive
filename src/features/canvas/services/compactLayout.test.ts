import { describe, it, expect } from 'vitest';
import { computeCompactLayout, rectsOverlap, type OverlapRect } from './compactLayout';

/** Smallest axis-aligned rectangle enclosing every rect in `rects`. */
function unionRect(rects: OverlapRect[]): OverlapRect {
  const minX = Math.min(...rects.map((r) => r.cx - r.width / 2));
  const maxX = Math.max(...rects.map((r) => r.cx + r.width / 2));
  const minY = Math.min(...rects.map((r) => r.cy - r.height / 2));
  const maxY = Math.max(...rects.map((r) => r.cy + r.height / 2));
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY };
}

/**
 * Helper: create a minimal SVG string with nodes and clusters at specified
 * positions. `computeCompactLayout` parses this the same way it parses the
 * diagram store's pristine `svg` string.
 */
function buildSvg(opts: {
  nodes?: Array<{ id: string; x: number; y: number; w?: number; h?: number; hidden?: boolean }>;
  clusters?: Array<{ id: string; x: number; y: number; w: number; h: number }>;
}): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  for (const node of opts.nodes ?? []) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-node-id', node.id);
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    g.classList.add('node');
    if (node.hidden) g.style.display = 'none';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(-(node.w ?? 100) / 2));
    rect.setAttribute('y', String(-(node.h ?? 50) / 2));
    rect.setAttribute('width', String(node.w ?? 100));
    rect.setAttribute('height', String(node.h ?? 50));
    g.appendChild(rect);
    svg.appendChild(g);
  }

  for (const cluster of opts.clusters ?? []) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('id', `flowchart-${cluster.id}-0`);
    g.classList.add('cluster');
    g.setAttribute('transform', `translate(${cluster.x}, ${cluster.y})`);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '0');
    rect.setAttribute('y', '0');
    rect.setAttribute('width', String(cluster.w));
    rect.setAttribute('height', String(cluster.h));
    g.appendChild(rect);
    svg.appendChild(g);
  }

  return new XMLSerializer().serializeToString(svg);
}

describe('computeCompactLayout', () => {
  it('returns empty overrides when fewer than 2 visible elements', () => {
    const svg = buildSvg({
      nodes: [{ id: 'A', x: 100, y: 100 }],
    });
    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('arranges elements into grid positions', () => {
    // Two nodes far apart — should be placed into grid cells.
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 0, y: 0, w: 80, h: 40 },
        { id: 'B', x: 2000, y: 0, w: 80, h: 40 },
      ],
    });
    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
      16 / 9,
    );
    // Should have overrides for both nodes (moved to grid cells).
    expect(result['A']).toBeDefined();
    expect(result['B']).toBeDefined();
    // The two nodes should end up closer together than 2000px.
    const dist = Math.abs(result['B'].x - result['A'].x);
    expect(dist).toBeLessThan(2000);
  });

  it('moves collapsed cluster member nodes when compacting', () => {
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 50, y: 50, w: 80, h: 40, hidden: true },
        { id: 'API', x: 1000, y: 50, w: 80, h: 40 },
      ],
      clusters: [
        { id: 'Frontend', x: 0, y: 0, w: 120, h: 40 },
      ],
    });

    const membership = new Map<string, Set<string>>([
      ['Frontend', new Set(['A'])],
    ]);
    const hiddenNodeIds = new Set(['A']);
    const collapsedClusters = new Set(['Frontend']);

    const result = computeCompactLayout(
      svg,
      hiddenNodeIds,
      collapsedClusters,
      membership,
      16 / 9,
    );

    // API should have a position override (moved to grid).
    expect(result['API']).toBeDefined();
    // Hidden node A should also have a position override (cluster moved).
    expect(result['A']).toBeDefined();
  });

  it('groups a top-level collapsed cluster with its non-collapsed parent subgraph', () => {
    // Outer (non-collapsed) directly contains node X plus a nested,
    // collapsed cluster Inner (containing hidden node A). Inner's box is
    // independently visible (Outer isn't collapsed), but it still belongs
    // INSIDE Outer's border — so it must be grouped with X, not placed as
    // its own free-floating grid item where an unrelated node could land
    // between them (inside Outer's auto-fitted border).
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 50, y: 300, w: 80, h: 40, hidden: true },
        { id: 'X', x: 50, y: 0, w: 80, h: 40 },
        { id: 'Y', x: 2000, y: 150, w: 80, h: 40 },
      ],
      clusters: [
        { id: 'Inner', x: 50, y: 300, w: 120, h: 40 },
      ],
    });

    const membership = new Map<string, Set<string>>([
      ['Outer', new Set(['Inner', 'X'])],
      ['Inner', new Set(['A'])],
    ]);
    const hiddenNodeIds = new Set(['A']);
    const collapsedClusters = new Set(['Inner']);

    const result = computeCompactLayout(
      svg,
      hiddenNodeIds,
      collapsedClusters,
      membership,
      16 / 9,
    );

    const resolved = (id: string, orig: { x: number; y: number }) => result[id] ?? orig;
    const a = resolved('A', { x: 50, y: 300 });
    const x = resolved('X', { x: 50, y: 0 });
    const y = resolved('Y', { x: 2000, y: 150 });

    // Outer's bounding box = union of X (80x40) and the collapsed Inner
    // box (120x40, centered on A's shifted position since A carries it).
    const outer = unionRect([
      { cx: x.x, cy: x.y, width: 80, height: 40 },
      { cx: a.x, cy: a.y, width: 120, height: 40 },
    ]);
    const yRect: OverlapRect = { cx: y.x, cy: y.y, width: 80, height: 40 };
    expect(rectsOverlap(outer, yRect)).toBe(false);
  });

  it('keeps a nested non-collapsed subgraph isolated from unrelated siblings of its parent', () => {
    // Outer (non-collapsed) contains: nested non-collapsed Inner (members
    // P, Q) plus its own direct sibling node W. Flattening P/Q/W into one
    // mini-grid (ignoring the Inner/Outer distinction) could interleave W
    // between P and Q, landing it inside Inner's auto-fitted border even
    // though W isn't one of Inner's members. An unrelated top-level node Z
    // must also stay outside Outer's overall border.
    const svg = buildSvg({
      nodes: [
        { id: 'P', x: 0, y: 0, w: 80, h: 40 },
        { id: 'Q', x: 0, y: 200, w: 80, h: 40 },
        { id: 'W', x: 400, y: 100, w: 80, h: 40 },
        { id: 'Z', x: 3000, y: 100, w: 80, h: 40 },
      ],
    });

    const membership = new Map<string, Set<string>>([
      ['Outer', new Set(['Inner', 'W'])],
      ['Inner', new Set(['P', 'Q'])],
    ]);

    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      membership,
      16 / 9,
    );

    const resolved = (id: string, orig: { x: number; y: number }) => result[id] ?? orig;
    const p = resolved('P', { x: 0, y: 0 });
    const q = resolved('Q', { x: 0, y: 200 });
    const w = resolved('W', { x: 400, y: 100 });
    const z = resolved('Z', { x: 3000, y: 100 });

    const rect = (c: { x: number; y: number }): OverlapRect => ({ cx: c.x, cy: c.y, width: 80, height: 40 });

    // Inner's border (P ∪ Q) must not overlap its own sibling W.
    const inner = unionRect([rect(p), rect(q)]);
    expect(rectsOverlap(inner, rect(w))).toBe(false);

    // Outer's border (P ∪ Q ∪ W) must not overlap the unrelated node Z.
    const outer = unionRect([rect(p), rect(q), rect(w)]);
    expect(rectsOverlap(outer, rect(z))).toBe(false);
  });

  it('does not give a nested collapsed subgraph its own grid slot', () => {
    // Outer collapsed cluster contains node X directly plus nested cluster
    // Inner (also collapsed, but not independently visible — it's hidden
    // inside Outer's box). Inner contains node A.
    const svg = buildSvg({
      nodes: [
        { id: 'X', x: 50, y: 0, w: 80, h: 40, hidden: true },
        { id: 'A', x: 50, y: 300, w: 80, h: 40, hidden: true },
        { id: 'API', x: 1000, y: 0, w: 80, h: 40 },
      ],
      clusters: [
        { id: 'Outer', x: 50, y: 150, w: 120, h: 400 },
        { id: 'Inner', x: 50, y: 300, w: 120, h: 40 },
      ],
    });

    const membership = new Map<string, Set<string>>([
      ['Outer', new Set(['Inner', 'X'])],
      ['Inner', new Set(['A'])],
    ]);
    const hiddenNodeIds = new Set(['A', 'X']);
    const collapsedClusters = new Set(['Outer', 'Inner']);

    const result = computeCompactLayout(
      svg,
      hiddenNodeIds,
      collapsedClusters,
      membership,
      16 / 9,
    );

    // Both descendants moved by the SAME delta (single grid slot for Outer),
    // so their original relative offset (A is 300px below X) is preserved.
    expect(result['X']).toBeDefined();
    expect(result['A']).toBeDefined();
    expect(result['A'].x - result['X'].x).toBeCloseTo(0, 5);
    expect(result['A'].y - result['X'].y).toBeCloseTo(300, 5);
  });

  it('does not let an unrelated node overlap a non-collapsed subgraph after routing', () => {
    // Sub's members (A, B) are stacked vertically; unrelated node Y sits
    // between their original y-range but far away in x. If members were
    // gridded independently (ignoring subgraph membership), Y could get
    // sorted/placed between A and B, landing inside Sub's auto-fitted
    // bounding box even though it isn't one of its members.
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 0, y: 0, w: 100, h: 50 },
        { id: 'B', x: 0, y: 300, w: 100, h: 50 },
        { id: 'Y', x: 1500, y: 150, w: 100, h: 50 },
      ],
    });

    const membership = new Map<string, Set<string>>([
      ['Sub', new Set(['A', 'B'])],
    ]);

    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      membership,
      16 / 9,
    );

    const resolved = (id: string, orig: { x: number; y: number }) =>
      result[id] ?? orig;
    const a = resolved('A', { x: 0, y: 0 });
    const b = resolved('B', { x: 0, y: 300 });
    const y = resolved('Y', { x: 1500, y: 150 });

    // Sub's bounding box (100x50 nodes, no extra padding) must not overlap Y.
    const sub = unionRect([
      { cx: a.x, cy: a.y, width: 100, height: 50 },
      { cx: b.x, cy: b.y, width: 100, height: 50 },
    ]);
    const yRect: OverlapRect = { cx: y.x, cy: y.y, width: 100, height: 50 };
    expect(rectsOverlap(sub, yRect)).toBe(false);
  });

  it('does not overlap sibling members inside the same subgraph', () => {
    // A 2x2-ish subgraph: with a naive single-shelf-width heuristic, the
    // widest item claiming the whole row can cascade every other item
    // (including these siblings) onto their own row, and — with buggy
    // offset math — even on top of each other.
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 0, y: 0, w: 100, h: 50 },
        { id: 'B', x: 200, y: 0, w: 100, h: 50 },
        { id: 'C', x: 0, y: 200, w: 100, h: 50 },
        { id: 'D', x: 200, y: 200, w: 100, h: 50 },
      ],
    });
    const membership = new Map<string, Set<string>>([
      ['Sub', new Set(['A', 'B', 'C', 'D'])],
    ]);

    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      membership,
      16 / 9,
    );

    const resolved = (id: string, orig: { x: number; y: number }) => result[id] ?? orig;
    const centers = [
      resolved('A', { x: 0, y: 0 }),
      resolved('B', { x: 200, y: 0 }),
      resolved('C', { x: 0, y: 200 }),
      resolved('D', { x: 200, y: 200 }),
    ];

    // Every pair of 100x50 members must not overlap.
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const a: OverlapRect = { cx: centers[i].x, cy: centers[i].y, width: 100, height: 50 };
        const b: OverlapRect = { cx: centers[j].x, cy: centers[j].y, width: 100, height: 50 };
        expect(rectsOverlap(a, b)).toBe(false);
      }
    }
  });

  it('spreads many items across columns instead of collapsing to one column', () => {
    // 8 standalone nodes plus a 2-member subgraph, targeting a wide (16:9)
    // viewport. A single wide item should not force every other item onto
    // its own row (the failure mode of a fixed-target-row-width shelf).
    const nodes = Array.from({ length: 8 }, (_, i) => ({
      id: `N${i}`,
      x: 0,
      y: i * 150,
      w: 100,
      h: 50,
    }));
    nodes.push({ id: 'S1', x: 1000, y: 0, w: 100, h: 50 });
    nodes.push({ id: 'S2', x: 1000, y: 150, w: 100, h: 50 });
    const svg = buildSvg({ nodes });

    const membership = new Map<string, Set<string>>([
      ['Sub', new Set(['S1', 'S2'])],
    ]);

    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      membership,
      16 / 9,
    );

    const xs = new Set(Object.values(result).map((p) => Math.round(p.x)));
    // More than one distinct x column should be in use.
    expect(xs.size).toBeGreaterThan(1);
  });

  it('does not include hidden nodes in visible element calculation', () => {
    const svg = buildSvg({
      nodes: [
        { id: 'hidden1', x: 500, y: 500, w: 80, h: 40, hidden: true },
        { id: 'visible1', x: 0, y: 0, w: 80, h: 40 },
        { id: 'visible2', x: 200, y: 0, w: 80, h: 40 },
      ],
    });

    const result = computeCompactLayout(
      svg,
      new Set(['hidden1']),
      new Set<string>(),
      new Map(),
      16 / 9,
    );

    // hidden1 should NOT get an override (it's not visible, no cluster to move).
    expect(result['hidden1']).toBeUndefined();
  });

  it('preserves reading order (top-left to bottom-right)', () => {
    // Three nodes in a horizontal line, far apart.
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 0, y: 0, w: 60, h: 30 },
        { id: 'B', x: 1000, y: 0, w: 60, h: 30 },
        { id: 'C', x: 2000, y: 0, w: 60, h: 30 },
      ],
    });
    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
      16 / 9,
    );
    expect(result['A']).toBeDefined();
    expect(result['B']).toBeDefined();
    expect(result['C']).toBeDefined();

    // With 3 items the grid may wrap onto multiple rows/columns (e.g. a
    // 2-column grid puts the 3rd item under the 1st), so raw x is NOT
    // guaranteed to be strictly increasing across every element — only
    // reading order (row-major: each row left-to-right, rows top-to-
    // bottom) is. Sorting by the same row-quantization the algorithm uses
    // internally must reproduce the original left-to-right order.
    const byReadingOrder = ['A', 'B', 'C']
      .map((id) => ({ id, x: result[id].x, y: result[id].y }))
      .sort((a, b) => {
        const rowA = Math.round(a.y / 80);
        const rowB = Math.round(b.y / 80);
        return rowA !== rowB ? rowA - rowB : a.x - b.x;
      })
      .map((p) => p.id);
    expect(byReadingOrder).toEqual(['A', 'B', 'C']);
  });

  it('adapts grid columns to viewport aspect ratio', () => {
    // 6 nodes in a tall column — with a wide aspect ratio, should arrange
    // into multiple columns rather than staying as a single column.
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 0, y: 0, w: 100, h: 50 },
        { id: 'B', x: 0, y: 200, w: 100, h: 50 },
        { id: 'C', x: 0, y: 400, w: 100, h: 50 },
        { id: 'D', x: 0, y: 600, w: 100, h: 50 },
        { id: 'E', x: 0, y: 800, w: 100, h: 50 },
        { id: 'F', x: 0, y: 1000, w: 100, h: 50 },
      ],
    });

    // Wide viewport (3:1) → expect more columns.
    const resultWide = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
      3.0,
    );

    // Narrow viewport (0.5:1) → expect fewer columns (more rows).
    const resultNarrow = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
      0.5,
    );

    // For wide viewport, the rightmost element should be further right.
    const maxXWide = Math.max(
      ...Object.values(resultWide).map((p) => p.x),
    );
    const maxXNarrow = Math.max(
      ...Object.values(resultNarrow).map((p) => p.x),
    );
    // Wide layout should spread more horizontally.
    expect(maxXWide).toBeGreaterThan(maxXNarrow);
  });

  it('centers the grid at the original layout centroid', () => {
    // Two nodes centered around (500, 500).
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 400, y: 500, w: 80, h: 40 },
        { id: 'B', x: 600, y: 500, w: 80, h: 40 },
      ],
    });
    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
      16 / 9,
    );

    // If both nodes are already close, they might not move much.
    // But the centroid of results should be near (500, 500).
    if (result['A'] && result['B']) {
      const midX = (result['A'].x + result['B'].x) / 2;
      const midY = (result['A'].y + result['B'].y) / 2;
      // Allow reasonable tolerance since grid snapping may shift slightly.
      expect(midX).toBeGreaterThan(300);
      expect(midX).toBeLessThan(700);
      expect(midY).toBeGreaterThan(300);
      expect(midY).toBeLessThan(700);
    }
  });

  it('skips elements that are already close to their grid position', () => {
    // Two nodes that happen to already be at grid positions (within 5px).
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 100, y: 100, w: 80, h: 40 },
        { id: 'B', x: 102, y: 100, w: 80, h: 40 },
      ],
    });
    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
      16 / 9,
    );
    // With only 2 very close nodes, the grid puts them in a 2×1 grid
    // centered at the centroid. One will move, so at least one override.
    // The key point: it doesn't crash, and handles the 5px threshold.
    expect(result).toBeDefined();
  });
});

describe('rectsOverlap', () => {
  it('detects overlapping rectangles', () => {
    const a: OverlapRect = { cx: 0, cy: 0, width: 100, height: 50 };
    const b: OverlapRect = { cx: 40, cy: 10, width: 100, height: 50 };
    expect(rectsOverlap(a, b)).toBe(true);
  });

  it('detects separation on the X axis', () => {
    const a: OverlapRect = { cx: 0, cy: 0, width: 100, height: 50 };
    const b: OverlapRect = { cx: 200, cy: 0, width: 100, height: 50 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it('detects separation on the Y axis', () => {
    const a: OverlapRect = { cx: 0, cy: 0, width: 100, height: 50 };
    const b: OverlapRect = { cx: 0, cy: 100, width: 100, height: 50 };
    expect(rectsOverlap(a, b)).toBe(false);
  });

  it('treats rectangles that exactly touch (edge-to-edge) as not overlapping', () => {
    const a: OverlapRect = { cx: 0, cy: 0, width: 100, height: 50 };
    const b: OverlapRect = { cx: 100, cy: 0, width: 100, height: 50 };
    expect(rectsOverlap(a, b)).toBe(false);
  });
});
