import { describe, it, expect, beforeEach } from 'vitest';
import { useDiagramStore } from '@/stores/diagramStore';

const SOURCE_WITH_SUBGRAPHS = `flowchart TD
  subgraph Outer
    subgraph Inner
      A --> B
    end
    C --> D
  end
  E --> F
`;

const SOURCE_WITHOUT_SUBGRAPHS = `flowchart TD
  A --> B
  B --> C
`;

describe('diagramStore.collapseAllClusters', () => {
  beforeEach(() => {
    useDiagramStore.setState({
      source: SOURCE_WITH_SUBGRAPHS,
      collapsedClusters: new Set<string>(),
    });
  });

  it('collapses all subgraph clusters found in the source', () => {
    useDiagramStore.getState().collapseAllClusters();
    const { collapsedClusters } = useDiagramStore.getState();
    expect(collapsedClusters.has('Outer')).toBe(true);
    expect(collapsedClusters.has('Inner')).toBe(true);
    expect(collapsedClusters.size).toBe(2);
  });

  it('is a no-op when source has no subgraphs', () => {
    useDiagramStore.setState({ source: SOURCE_WITHOUT_SUBGRAPHS });
    useDiagramStore.getState().collapseAllClusters();
    const { collapsedClusters } = useDiagramStore.getState();
    expect(collapsedClusters.size).toBe(0);
  });

  it('is a no-op when all clusters are already collapsed', () => {
    useDiagramStore.setState({
      collapsedClusters: new Set(['Outer', 'Inner']),
    });
    const before = useDiagramStore.getState().collapsedClusters;
    useDiagramStore.getState().collapseAllClusters();
    const after = useDiagramStore.getState().collapsedClusters;
    // Reference equality — same object since no state change happened.
    expect(after).toBe(before);
  });

  it('collapses remaining clusters when some are already collapsed', () => {
    useDiagramStore.setState({
      collapsedClusters: new Set(['Inner']),
    });
    useDiagramStore.getState().collapseAllClusters();
    const { collapsedClusters } = useDiagramStore.getState();
    expect(collapsedClusters.has('Outer')).toBe(true);
    expect(collapsedClusters.has('Inner')).toBe(true);
    expect(collapsedClusters.size).toBe(2);
  });
});

describe('diagramStore.expandAllClusters', () => {
  beforeEach(() => {
    useDiagramStore.setState({
      source: SOURCE_WITH_SUBGRAPHS,
      collapsedClusters: new Set(['Outer', 'Inner']),
    });
  });

  it('expands all collapsed clusters', () => {
    useDiagramStore.getState().expandAllClusters();
    const { collapsedClusters } = useDiagramStore.getState();
    expect(collapsedClusters.size).toBe(0);
  });

  it('is a no-op when no clusters are collapsed', () => {
    useDiagramStore.setState({ collapsedClusters: new Set() });
    const before = useDiagramStore.getState().collapsedClusters;
    useDiagramStore.getState().expandAllClusters();
    const after = useDiagramStore.getState().collapsedClusters;
    expect(after).toBe(before);
  });
});
