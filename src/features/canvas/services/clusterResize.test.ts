import { describe, it, expect } from 'vitest';
import { parseSubgraphMembership } from './clusterResize';

describe('parseSubgraphMembership', () => {
  it('returns empty map for diagrams without subgraphs', () => {
    const src = 'flowchart LR\n  A --> B --> C';
    expect(parseSubgraphMembership(src).size).toBe(0);
  });

  it('parses a single subgraph', () => {
    const src = `
flowchart LR
  subgraph sub1[My Sub]
    A --> B
  end
  C --> A
`;
    const m = parseSubgraphMembership(src);
    expect(m.has('sub1')).toBe(true);
    expect(m.get('sub1')!.has('A')).toBe(true);
    expect(m.get('sub1')!.has('B')).toBe(true);
    // C is outside the subgraph
    expect(m.get('sub1')!.has('C')).toBe(false);
  });

  it('parses nested subgraphs and records child sub as member of parent', () => {
    const src = `
flowchart TD
  subgraph outer
    subgraph inner
      X --> Y
    end
    Z --> X
  end
`;
    const m = parseSubgraphMembership(src);
    expect(m.has('outer')).toBe(true);
    expect(m.has('inner')).toBe(true);
    // inner is a member of outer
    expect(m.get('outer')!.has('inner')).toBe(true);
    // X, Y are members of inner
    expect(m.get('inner')!.has('X')).toBe(true);
    expect(m.get('inner')!.has('Y')).toBe(true);
    // Z is a member of outer (not inner)
    expect(m.get('outer')!.has('Z')).toBe(true);
    expect(m.get('inner')!.has('Z')).toBe(false);
  });

  it('parses deeply nested subgraphs (3 levels)', () => {
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
    const m = parseSubgraphMembership(src);
    expect(m.get('leaf')!.has('A')).toBe(true);
    expect(m.get('leaf')!.has('B')).toBe(true);
    expect(m.get('mid')!.has('leaf')).toBe(true);
    expect(m.get('mid')!.has('C')).toBe(true);
    expect(m.get('top')!.has('mid')).toBe(true);
    expect(m.get('top')!.has('D')).toBe(true);
  });

  it('handles multiple sibling subgraphs', () => {
    const src = `
flowchart LR
  subgraph s1
    A --> B
  end
  subgraph s2
    C --> D
  end
  B --> C
`;
    const m = parseSubgraphMembership(src);
    expect(m.get('s1')!.has('A')).toBe(true);
    expect(m.get('s2')!.has('C')).toBe(true);
    // s1 and s2 are not members of each other
    expect(m.get('s1')!.has('s2')).toBe(false);
  });
});
