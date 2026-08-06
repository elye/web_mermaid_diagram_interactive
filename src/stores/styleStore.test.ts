/**
 * Tests for styleStore — focusing on cluster style methods introduced in the
 * subgraph-control feature (setClusterStyle, clearClusterStyle, hydrate, reset).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStyleStore } from './styleStore';

beforeEach(() => {
  useStyleStore.getState().reset();
});

describe('setClusterStyle', () => {
  it('stores a style override for a cluster id', () => {
    useStyleStore.getState().setClusterStyle('subA', { fill: '#ff0000' });
    expect(useStyleStore.getState().clusterStyles['subA']?.fill).toBe('#ff0000');
  });

  it('merges patches — does not overwrite unrelated properties', () => {
    useStyleStore.getState().setClusterStyle('subA', { fill: '#ff0000' });
    useStyleStore.getState().setClusterStyle('subA', { stroke: '#0000ff' });

    const s = useStyleStore.getState().clusterStyles['subA'];
    expect(s?.fill).toBe('#ff0000');
    expect(s?.stroke).toBe('#0000ff');
  });

  it('later patch wins for the same property', () => {
    useStyleStore.getState().setClusterStyle('subA', { fill: '#ff0000' });
    useStyleStore.getState().setClusterStyle('subA', { fill: '#00ff00' });

    expect(useStyleStore.getState().clusterStyles['subA']?.fill).toBe('#00ff00');
  });

  it('keeps independent styles for different cluster ids', () => {
    useStyleStore.getState().setClusterStyle('subA', { fill: '#ff0000' });
    useStyleStore.getState().setClusterStyle('subB', { fill: '#0000ff' });

    expect(useStyleStore.getState().clusterStyles['subA']?.fill).toBe('#ff0000');
    expect(useStyleStore.getState().clusterStyles['subB']?.fill).toBe('#0000ff');
  });
});

describe('clearClusterStyle', () => {
  it('removes the style for the given cluster id', () => {
    useStyleStore.getState().setClusterStyle('subA', { fill: '#ff0000' });
    useStyleStore.getState().clearClusterStyle('subA');

    expect(useStyleStore.getState().clusterStyles['subA']).toBeUndefined();
  });

  it('leaves other cluster styles intact', () => {
    useStyleStore.getState().setClusterStyle('subA', { fill: '#ff0000' });
    useStyleStore.getState().setClusterStyle('subB', { fill: '#0000ff' });
    useStyleStore.getState().clearClusterStyle('subA');

    expect(useStyleStore.getState().clusterStyles['subB']?.fill).toBe('#0000ff');
  });

  it('is a no-op when the cluster has no style', () => {
    expect(() => useStyleStore.getState().clearClusterStyle('nonExistent')).not.toThrow();
  });
});

describe('hydrate', () => {
  it('restores cluster styles from a persisted snapshot', () => {
    useStyleStore.getState().hydrate({
      clusterStyles: { subA: { fill: '#aabbcc', stroke: '#112233' } },
    });
    expect(useStyleStore.getState().clusterStyles['subA']?.fill).toBe('#aabbcc');
    expect(useStyleStore.getState().clusterStyles['subA']?.stroke).toBe('#112233');
  });
});

describe('reset', () => {
  it('clears all cluster styles', () => {
    useStyleStore.getState().setClusterStyle('subA', { fill: '#ff0000' });
    useStyleStore.getState().setClusterStyle('subB', { fill: '#0000ff' });
    useStyleStore.getState().reset();

    expect(Object.keys(useStyleStore.getState().clusterStyles).length).toBe(0);
  });

  it('also clears node and edge styles', () => {
    useStyleStore.getState().setNodeStyle('nodeA', { fill: '#ff0000' });
    useStyleStore.getState().setEdgeStyle('edge1', { stroke: '#00ff00' });
    useStyleStore.getState().reset();

    expect(Object.keys(useStyleStore.getState().nodeStyles).length).toBe(0);
    expect(Object.keys(useStyleStore.getState().edgeStyles).length).toBe(0);
  });
});
