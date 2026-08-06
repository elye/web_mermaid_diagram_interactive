/**
 * Tests for subgraphParser.ts and the related extractClusterUserId helper.
 *
 * Coverage:
 *  - parseSubgraphMembership (delegated, sanity checks)
 *  - collectAllNodeIds        — the key function used by useClusterDrag
 *  - extractClusterUserId     — shared helper used by DiagramCanvas + cluster pipeline
 */
import { describe, it, expect } from 'vitest';
import { parseSubgraphMembership, collectAllNodeIds } from './subgraphParser';
import { extractClusterUserId } from './clusterElements';

// ─── collectAllNodeIds ─────────────────────────────────────────────────────────

describe('collectAllNodeIds', () => {
  it('returns leaf nodes of a flat subgraph', () => {
    const src = `
flowchart LR
  subgraph s1
    A --> B
  end
`;
    const membership = parseSubgraphMembership(src);
    const ids = collectAllNodeIds('s1', membership);
    expect(ids.has('A')).toBe(true);
    expect(ids.has('B')).toBe(true);
    // The subgraph id itself must NOT appear in the result
    expect(ids.has('s1')).toBe(false);
  });

  it('recursively collects leaf nodes from nested subgraphs', () => {
    const src = `
flowchart TD
  subgraph outer
    subgraph inner
      X --> Y
    end
    Z --> X
  end
`;
    const membership = parseSubgraphMembership(src);

    // outer should yield X, Y (via inner) + Z
    const outerIds = collectAllNodeIds('outer', membership);
    expect(outerIds.has('X')).toBe(true);
    expect(outerIds.has('Y')).toBe(true);
    expect(outerIds.has('Z')).toBe(true);
    // nested subgraph id should NOT appear
    expect(outerIds.has('inner')).toBe(false);

    // inner should yield only X, Y
    const innerIds = collectAllNodeIds('inner', membership);
    expect(innerIds.has('X')).toBe(true);
    expect(innerIds.has('Y')).toBe(true);
    expect(innerIds.has('Z')).toBe(false);
    expect(innerIds.size).toBe(2);
  });

  it('handles 3-level deep nesting', () => {
    const src = `
flowchart TD
  subgraph top
    subgraph mid
      subgraph leaf
        A --> B
      end
      C --> A
    end
    D --> C
  end
`;
    const membership = parseSubgraphMembership(src);
    const topIds = collectAllNodeIds('top', membership);

    expect(topIds.has('A')).toBe(true);
    expect(topIds.has('B')).toBe(true);
    expect(topIds.has('C')).toBe(true);
    expect(topIds.has('D')).toBe(true);
    // No subgraph ids in the result
    expect(topIds.has('top')).toBe(false);
    expect(topIds.has('mid')).toBe(false);
    expect(topIds.has('leaf')).toBe(false);
  });

  it('returns an empty set for an unknown cluster id', () => {
    const src = `
flowchart LR
  subgraph s1
    A --> B
  end
`;
    const membership = parseSubgraphMembership(src);
    const ids = collectAllNodeIds('doesNotExist', membership);
    expect(ids.size).toBe(0);
  });

  it('returns empty for an empty membership map', () => {
    const ids = collectAllNodeIds('anything', new Map());
    expect(ids.size).toBe(0);
  });

  it('does not infinite-loop on a cyclic membership map', () => {
    // Manually construct a cycle: a ↔ b
    const membership = new Map<string, Set<string>>([
      ['a', new Set(['b'])],
      ['b', new Set(['a'])],
    ]);
    // Should terminate without throwing
    const ids = collectAllNodeIds('a', membership);
    // Both are sub-clusters with no plain leaf, result is empty
    expect(ids.size).toBe(0);
  });

  it('returns nodes only once even when referenced multiple times', () => {
    // A appears in two different edge declarations inside the same subgraph
    const src = `
flowchart LR
  subgraph s1
    A --> B
    B --> A
  end
`;
    const membership = parseSubgraphMembership(src);
    const ids = collectAllNodeIds('s1', membership);
    // Set semantics — A and B appear once each
    expect(ids.size).toBe(2);
  });

  it('handles sibling subgraphs without cross-contaminating results', () => {
    const src = `
flowchart LR
  subgraph left
    A --> B
  end
  subgraph right
    C --> D
  end
`;
    const membership = parseSubgraphMembership(src);
    const leftIds = collectAllNodeIds('left', membership);
    const rightIds = collectAllNodeIds('right', membership);

    expect(leftIds.has('A')).toBe(true);
    expect(leftIds.has('B')).toBe(true);
    expect(leftIds.has('C')).toBe(false);
    expect(leftIds.has('D')).toBe(false);

    expect(rightIds.has('C')).toBe(true);
    expect(rightIds.has('D')).toBe(true);
    expect(rightIds.has('A')).toBe(false);
    expect(rightIds.has('B')).toBe(false);
  });
});

// ─── extractClusterUserId ──────────────────────────────────────────────────────

describe('extractClusterUserId', () => {
  it('strips the flowchart- prefix and numeric suffix', () => {
    expect(extractClusterUserId('flowchart-mySubgraph-7')).toBe('mySubgraph');
  });

  it('strips the graph- prefix and numeric suffix', () => {
    expect(extractClusterUserId('graph-backend-2')).toBe('backend');
  });

  it('strips the subgraph- prefix and numeric suffix', () => {
    expect(extractClusterUserId('subgraph-services-10')).toBe('services');
  });

  it('strips only the trailing numeric suffix when there is no known prefix', () => {
    // Older Mermaid versions used <id>-<n> directly
    expect(extractClusterUserId('myCluster-3')).toBe('myCluster');
  });

  it('handles ids that contain hyphens in the user part', () => {
    // e.g. flowchart-my-cluster-name-4 → my-cluster-name
    expect(extractClusterUserId('flowchart-my-cluster-name-4')).toBe('my-cluster-name');
  });

  it('returns the raw id as-is when there is no suffix to strip', () => {
    // No numeric suffix → return the raw string (fall-through in the implementation)
    expect(extractClusterUserId('plainId')).toBe('plainId');
  });

  it('returns null for an empty string', () => {
    expect(extractClusterUserId('')).toBeNull();
  });
});
