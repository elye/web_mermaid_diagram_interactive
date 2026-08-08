import { describe, it, expect } from 'vitest';
import { computeCollapseState, bundleLabel, type BundledEdge } from './collapseUtils';
import type { EdgeMeta } from '@/shared/types/diagram';

// ─── helpers ────────────────────────────────────────────────────────────────

const edge = (id: string, sourceId: string, targetId: string, bidirectional?: boolean): EdgeMeta =>
  bidirectional ? { id, sourceId, targetId, bidirectional: true } : { id, sourceId, targetId };

const set = <T,>(...ids: T[]): Set<T> => new Set(ids);
const mmap = (entries: [string, Set<string>][]) => new Map<string, Set<string>>(entries);

// Sort helper to make bundle assertions order-independent.
const byKey = (arr: readonly BundledEdge[]): BundledEdge[] =>
  [...arr].sort((a, b) => {
    const k = (b_: BundledEdge) => `${b_.clusterId}|${b_.externalNodeId}|${b_.direction}`;
    return k(a).localeCompare(k(b));
  });

// ─── empty / degenerate ─────────────────────────────────────────────────────

describe('computeCollapseState — empty inputs', () => {
  it('returns empty deltas when no clusters are collapsed', () => {
    const membership = mmap([['sub1', set('A', 'B')]]);
    const edges = [edge('e1', 'A', 'B'), edge('e2', 'A', 'X')];
    const r = computeCollapseState(new Set(), membership, edges);
    expect(r.hiddenNodeIds.size).toBe(0);
    expect(r.hiddenEdgeIds.size).toBe(0);
    expect(r.bundledEdges).toEqual([]);
  });

  it('returns empty bundles when the collapsed cluster is unknown', () => {
    // A collapsed id with no membership entry can't hide anything.
    const r = computeCollapseState(set('ghost'), mmap([]), [edge('e', 'A', 'B')]);
    expect(r.hiddenNodeIds.size).toBe(0);
    expect(r.hiddenEdgeIds.size).toBe(0);
  });
});

// ─── single collapsed cluster ───────────────────────────────────────────────

describe('computeCollapseState — single cluster', () => {
  const membership = mmap([['sub1', set('A', 'B', 'C')]]);
  //   sub1 = { A, B, C }
  //   externals: X, Y

  it('hides all leaf members of the collapsed cluster', () => {
    const r = computeCollapseState(set('sub1'), membership, []);
    expect([...r.hiddenNodeIds].sort()).toEqual(['A', 'B', 'C']);
  });

  it('bundles multiple in-edges from the same external node into one arrow with count', () => {
    // 3 external → cluster edges from X
    const edges = [edge('e1', 'X', 'A'), edge('e2', 'X', 'B'), edge('e3', 'X', 'C')];
    const r = computeCollapseState(set('sub1'), membership, edges);
    expect([...r.hiddenEdgeIds].sort()).toEqual(['e1', 'e2', 'e3']);
    expect(r.bundledEdges).toHaveLength(1);
    expect(r.bundledEdges[0]).toMatchObject({
      clusterId: 'sub1',
      externalNodeId: 'X',
      direction: 'in',
      count: 3,
    });
    expect([...r.bundledEdges[0].edgeIds].sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('bundles multiple out-edges to the same external node with direction=out', () => {
    const edges = [edge('e1', 'A', 'Y'), edge('e2', 'B', 'Y')];
    const r = computeCollapseState(set('sub1'), membership, edges);
    expect(r.bundledEdges).toHaveLength(1);
    expect(r.bundledEdges[0]).toMatchObject({
      clusterId: 'sub1',
      externalNodeId: 'Y',
      direction: 'out',
      count: 2,
    });
  });

  it('keeps in and out bundles to the same external node separate', () => {
    const edges = [edge('in1', 'X', 'A'), edge('out1', 'B', 'X')];
    const r = computeCollapseState(set('sub1'), membership, edges);
    expect(byKey(r.bundledEdges).map((b) => `${b.direction}:${b.externalNodeId}:${b.count}`)).toEqual([
      'in:X:1',
      'out:X:1',
    ]);
  });

  it('groups bidirectional edges under direction=bidir', () => {
    const edges = [edge('b1', 'A', 'X', true), edge('b2', 'B', 'X', true)];
    const r = computeCollapseState(set('sub1'), membership, edges);
    expect(r.bundledEdges).toHaveLength(1);
    expect(r.bundledEdges[0]).toMatchObject({
      clusterId: 'sub1',
      externalNodeId: 'X',
      direction: 'bidir',
      count: 2,
    });
  });

  it('hides purely internal edges without emitting a bundle', () => {
    // A → B and B → C are both inside sub1
    const edges = [edge('int1', 'A', 'B'), edge('int2', 'B', 'C'), edge('crossing', 'A', 'Y')];
    const r = computeCollapseState(set('sub1'), membership, edges);
    expect([...r.hiddenEdgeIds].sort()).toEqual(['crossing', 'int1', 'int2']);
    expect(r.bundledEdges).toHaveLength(1);
    expect(r.bundledEdges[0].externalNodeId).toBe('Y');
  });

  it('does not touch edges outside the cluster', () => {
    const edges = [edge('e1', 'X', 'Y'), edge('e2', 'A', 'Y')];
    const r = computeCollapseState(set('sub1'), membership, edges);
    expect(r.hiddenEdgeIds.has('e1')).toBe(false);
    expect(r.hiddenEdgeIds.has('e2')).toBe(true);
  });

  it('skips edges with null endpoints', () => {
    const edges: EdgeMeta[] = [{ id: 'orphan', sourceId: null, targetId: 'A' }];
    const r = computeCollapseState(set('sub1'), membership, edges);
    expect(r.hiddenEdgeIds.size).toBe(0);
    expect(r.bundledEdges).toEqual([]);
  });
});

// ─── cluster-to-cluster crossings ───────────────────────────────────────────

describe('computeCollapseState — cluster-to-cluster', () => {
  const membership = mmap([
    ['sub1', set('A', 'B')],
    ['sub2', set('C', 'D')],
  ]);

  it('bundles edges crossing two collapsed clusters as a single arrow', () => {
    const edges = [edge('e1', 'A', 'C'), edge('e2', 'B', 'D')];
    const r = computeCollapseState(set('sub1', 'sub2'), membership, edges);
    // Both endpoints hidden.
    expect([...r.hiddenNodeIds].sort()).toEqual(['A', 'B', 'C', 'D']);
    // A single bundle recorded on the source cluster with target cluster as external.
    expect(r.bundledEdges).toHaveLength(1);
    expect(r.bundledEdges[0]).toMatchObject({
      clusterId: 'sub1',
      externalNodeId: 'sub2',
      direction: 'out',
      count: 2,
    });
  });

  it('collapsing only one side treats the other side as external nodes', () => {
    const edges = [edge('e1', 'A', 'C'), edge('e2', 'B', 'D')];
    const r = computeCollapseState(set('sub1'), membership, edges);
    const bundles = byKey(r.bundledEdges);
    expect(bundles).toHaveLength(2);
    expect(bundles.map((b) => `${b.direction}:${b.externalNodeId}`).sort()).toEqual([
      'out:C',
      'out:D',
    ]);
  });
});

// ─── nested collapse ────────────────────────────────────────────────────────

describe('computeCollapseState — nested subgraphs', () => {
  // outer contains { inner, X }; inner contains { A, B }.
  const membership = mmap([
    ['outer', set('inner', 'X')],
    ['inner', set('A', 'B')],
  ]);

  it('collapsing the outer cluster hides all descendants (leaves only)', () => {
    const r = computeCollapseState(set('outer'), membership, []);
    expect([...r.hiddenNodeIds].sort()).toEqual(['A', 'B', 'X']);
  });

  it('outermost-wins: an edge crossing outer is attributed to outer, not inner', () => {
    const edges = [edge('e1', 'A', 'Y')];
    const r = computeCollapseState(set('outer', 'inner'), membership, edges);
    expect(r.bundledEdges).toHaveLength(1);
    expect(r.bundledEdges[0]).toMatchObject({
      clusterId: 'outer', // NOT 'inner' — outermost collapsed ancestor
      externalNodeId: 'Y',
      direction: 'out',
    });
  });

  it('collapsing only inner: X (a sibling in outer, not inner) is not hidden', () => {
    const edges = [edge('e1', 'A', 'X')];
    const r = computeCollapseState(set('inner'), membership, edges);
    expect(r.hiddenNodeIds.has('X')).toBe(false);
    expect(r.hiddenNodeIds.has('A')).toBe(true);
    expect(r.bundledEdges).toHaveLength(1);
    expect(r.bundledEdges[0]).toMatchObject({
      clusterId: 'inner',
      externalNodeId: 'X',
      direction: 'out',
    });
  });
});

// ─── bundleLabel ────────────────────────────────────────────────────────────

describe('bundleLabel', () => {
  it('returns null for a single edge', () => {
    expect(bundleLabel(1)).toBeNull();
    expect(bundleLabel(0)).toBeNull();
  });
  it('returns ×N for N > 1', () => {
    expect(bundleLabel(2)).toBe('×2');
    expect(bundleLabel(10)).toBe('×10');
  });
});
