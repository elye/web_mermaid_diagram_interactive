/**
 * Tests for selectionStore — focusing on cluster selection behaviour introduced
 * in the subgraph-control feature (selectCluster, mutual-exclusion with nodes
 * and edges).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSelectionStore } from './selectionStore';

// Reset the store to a clean slate before each test.
beforeEach(() => {
  useSelectionStore.getState().clear();
});

describe('selectCluster', () => {
  it('sets selectedClusterId and clears nodes and edges', () => {
    // First select a node and an edge to prove they get cleared.
    useSelectionStore.getState().select('nodeA');
    useSelectionStore.getState().selectEdge('edge1');

    useSelectionStore.getState().selectCluster('subA');

    const s = useSelectionStore.getState();
    expect(s.selectedClusterId).toBe('subA');
    expect(s.selectedNodeIds.size).toBe(0);
    expect(s.selectedEdgeIds.size).toBe(0);
  });

  it('deselects by passing null', () => {
    useSelectionStore.getState().selectCluster('subA');
    useSelectionStore.getState().selectCluster(null);

    expect(useSelectionStore.getState().selectedClusterId).toBeNull();
  });

  it('replaces the previous cluster selection', () => {
    useSelectionStore.getState().selectCluster('subA');
    useSelectionStore.getState().selectCluster('subB');

    expect(useSelectionStore.getState().selectedClusterId).toBe('subB');
  });
});

describe('select (node) clears cluster', () => {
  it('clears selectedClusterId when a node is selected', () => {
    useSelectionStore.getState().selectCluster('subA');
    useSelectionStore.getState().select('nodeA');

    const s = useSelectionStore.getState();
    expect(s.selectedClusterId).toBeNull();
    expect(s.selectedNodeIds.has('nodeA')).toBe(true);
  });
});

describe('selectEdge clears cluster', () => {
  it('clears selectedClusterId when an edge is selected', () => {
    useSelectionStore.getState().selectCluster('subA');
    useSelectionStore.getState().selectEdge('edge1');

    const s = useSelectionStore.getState();
    expect(s.selectedClusterId).toBeNull();
    expect(s.selectedEdgeIds.has('edge1')).toBe(true);
  });
});

describe('clear', () => {
  it('clears cluster along with nodes and edges', () => {
    useSelectionStore.getState().selectCluster('subA');
    useSelectionStore.getState().clear();

    const s = useSelectionStore.getState();
    expect(s.selectedClusterId).toBeNull();
    expect(s.selectedNodeIds.size).toBe(0);
    expect(s.selectedEdgeIds.size).toBe(0);
  });
});

describe('isSelected', () => {
  it('does not report clusters as selected via isSelected (cluster has its own field)', () => {
    useSelectionStore.getState().selectCluster('subA');
    // isSelected only checks nodeIds and edgeIds — not clusters
    expect(useSelectionStore.getState().isSelected('subA')).toBe(false);
  });
});
