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
      new Map(),
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('returns empty overrides when layout is already compact', () => {
    const svg = buildSvg({
      nodes: [
        { id: 'A', x: 50, y: 50, w: 100, h: 50 },
        { id: 'B', x: 160, y: 50, w: 100, h: 50 },
      ],
    });
    const result = computeCompactLayout(
      svg,
      new Set<string>(),
      new Set<string>(),
      new Map(),
    );
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('compacts nodes that are very far apart', () => {
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
    );
    expect(result['A']).toBeDefined();
    expect(result['B']).toBeDefined();
    expect(result['A'].x).toBeGreaterThan(0);
    expect(result['B'].x).toBeLessThan(2000);
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

    const result = computeCompactLayout(svg, hiddenNodeIds, collapsedClusters, membership);

    expect(result['API']).toBeDefined();
    expect(result['API'].x).toBeLessThan(1000);
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
    );

    expect(result['hidden1']).toBeUndefined();
  });

  it('preserves relative ordering of elements after compaction', () => {
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
    );
    expect(result['A']).toBeDefined();
    expect(result['B']).toBeDefined();
    expect(result['C']).toBeDefined();
    expect(result['A'].x).toBeLessThan(result['B'].x);
    expect(result['B'].x).toBeLessThan(result['C'].x);
  });
});
