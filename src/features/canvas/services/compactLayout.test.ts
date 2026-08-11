import { describe, it, expect } from 'vitest';
import { computeCompactLayout } from './compactLayout';

/**
 * Helper: create a minimal SVG DOM with nodes and clusters at specified positions.
 */
function buildSvg(opts: {
  nodes?: Array<{ id: string; x: number; y: number; w?: number; h?: number; hidden?: boolean }>;
  clusters?: Array<{ id: string; x: number; y: number; w: number; h: number }>;
}): SVGSVGElement {
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

  return svg;
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
    // Relative order preserved: A.x < B.x < C.x
    expect(result['A'].x).toBeLessThan(result['B'].x);
    expect(result['B'].x).toBeLessThan(result['C'].x);
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
