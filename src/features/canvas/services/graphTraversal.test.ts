import { describe, it, expect } from 'vitest';
import { getConnectedHighlights } from './graphTraversal';
import type { EdgeMeta } from '@/shared/types/diagram';

// ─── helpers ────────────────────────────────────────────────────────────────

function edge(id: string, sourceId: string | null, targetId: string | null): EdgeMeta {
  return { id, sourceId, targetId };
}

function biEdge(id: string, sourceId: string, targetId: string): EdgeMeta {
  return { id, sourceId, targetId, bidirectional: true };
}

function sel(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

// ─── empty / degenerate ─────────────────────────────────────────────────────

describe('getConnectedHighlights — empty / degenerate', () => {
  it('returns empty sets when selection is empty', () => {
    const edges = [edge('e1', 'A', 'B')];
    const result = getConnectedHighlights(new Set(), edges);
    expect(result.sourceNodeIds.size).toBe(0);
    expect(result.sinkNodeIds.size).toBe(0);
    expect(result.connectedEdgeIds.size).toBe(0);
  });

  it('returns empty sets when there are no edges', () => {
    const result = getConnectedHighlights(sel('A'), []);
    expect(result.sourceNodeIds.size).toBe(0);
    expect(result.sinkNodeIds.size).toBe(0);
    expect(result.connectedEdgeIds.size).toBe(0);
  });

  it('skips edges with null sourceId or targetId', () => {
    const edges = [edge('e1', null, 'B'), edge('e2', 'A', null)];
    const result = getConnectedHighlights(sel('B'), edges);
    expect(result.sourceNodeIds.size).toBe(0);
    expect(result.connectedEdgeIds.size).toBe(0);
  });
});

// ─── linear chain A → B → C ─────────────────────────────────────────────────

describe('getConnectedHighlights — linear chain A → B → C', () => {
  // A --e1--> B --e2--> C
  const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')];

  it('selecting B: A is source, C is sink, both edges connected', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('B'), edges);
    expect([...sourceNodeIds]).toEqual(['A']);
    expect([...sinkNodeIds]).toEqual(['C']);
    expect([...connectedEdgeIds].sort()).toEqual(['e1', 'e2']);
  });

  it('selecting A: only C is sink (no sources), e1 is connected', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('A'), edges);
    expect(sourceNodeIds.size).toBe(0);
    expect([...sinkNodeIds]).toEqual(['B']);
    expect([...connectedEdgeIds]).toEqual(['e1']);
  });

  it('selecting C: only A→B is NOT included; e2 connects B→C', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('C'), edges);
    expect([...sourceNodeIds]).toEqual(['B']);
    expect(sinkNodeIds.size).toBe(0);
    expect([...connectedEdgeIds]).toEqual(['e2']);
  });
});

// ─── diamond: A → B, A → C, B → D, C → D ────────────────────────────────────

describe('getConnectedHighlights — diamond A→B, A→C, B→D, C→D', () => {
  const edges = [
    edge('e-ab', 'A', 'B'),
    edge('e-ac', 'A', 'C'),
    edge('e-bd', 'B', 'D'),
    edge('e-cd', 'C', 'D'),
  ];

  it('selecting D: B and C are sources; both incoming edges connected', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('D'), edges);
    expect([...sourceNodeIds].sort()).toEqual(['B', 'C']);
    expect(sinkNodeIds.size).toBe(0);
    expect([...connectedEdgeIds].sort()).toEqual(['e-bd', 'e-cd']);
  });

  it('selecting A: B and C are sinks; both outgoing edges connected', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('A'), edges);
    expect(sourceNodeIds.size).toBe(0);
    expect([...sinkNodeIds].sort()).toEqual(['B', 'C']);
    expect([...connectedEdgeIds].sort()).toEqual(['e-ab', 'e-ac']);
  });
});

// ─── multi-node selection ────────────────────────────────────────────────────

describe('getConnectedHighlights — multi-node selection', () => {
  // A → B → C, A → C
  const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'A', 'C')];

  it('selecting {B, C}: A is source; intra-selection edge e2 is connected; e3 (A→C) is connected', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(
      sel('B', 'C'),
      edges,
    );
    expect([...sourceNodeIds]).toEqual(['A']);
    expect(sinkNodeIds.size).toBe(0);
    // e1 (A→B): target B selected, source A is upstream → connected
    // e2 (B→C): both selected → connected
    // e3 (A→C): target C selected, source A is upstream → connected
    expect([...connectedEdgeIds].sort()).toEqual(['e1', 'e2', 'e3']);
  });

  it('selecting {A, B}: C is sink; e1 is intra-selection; e2 points to sink', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(
      sel('A', 'B'),
      edges,
    );
    expect(sourceNodeIds.size).toBe(0);
    expect([...sinkNodeIds].sort()).toEqual(['C']);
    // e1 (A→B): both selected → connected
    // e2 (B→C): target C is sink → connected
    // e3 (A→C): target C is sink → connected
    expect([...connectedEdgeIds].sort()).toEqual(['e1', 'e2', 'e3']);
  });
});

// ─── self-loops ──────────────────────────────────────────────────────────────

describe('getConnectedHighlights — self-loops', () => {
  it('self-loop on a selected node appears in connectedEdgeIds only (not source/sink)', () => {
    const edges = [edge('loop', 'A', 'A'), edge('e1', 'A', 'B')];
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('A'), edges);
    // The self-loop should be connected
    expect(connectedEdgeIds.has('loop')).toBe(true);
    // A should NOT appear as its own source or sink
    expect(sourceNodeIds.has('A')).toBe(false);
    expect(sinkNodeIds.has('A')).toBe(false);
    // B is still a normal sink
    expect(sinkNodeIds.has('B')).toBe(true);
    expect(connectedEdgeIds.has('e1')).toBe(true);
  });

  it('self-loop on an unselected node is not included', () => {
    const edges = [edge('loop-b', 'B', 'B'), edge('e1', 'A', 'B')];
    const { connectedEdgeIds } = getConnectedHighlights(sel('A'), edges);
    expect(connectedEdgeIds.has('loop-b')).toBe(false);
    expect(connectedEdgeIds.has('e1')).toBe(true);
  });
});

// ─── selected nodes are NOT in source/sink sets ──────────────────────────────

describe('getConnectedHighlights — selected nodes excluded from source/sink', () => {
  it('a selected node never appears as its own source or sink', () => {
    // A → A (self-loop) + A → B
    const edges = [edge('self', 'A', 'A'), edge('e1', 'A', 'B')];
    const { sourceNodeIds, sinkNodeIds } = getConnectedHighlights(sel('A'), edges);
    expect(sourceNodeIds.has('A')).toBe(false);
    expect(sinkNodeIds.has('A')).toBe(false);
  });

  it('when B and C are both selected, neither is in the other\'s source/sink', () => {
    const edges = [edge('e1', 'B', 'C')];
    const { sourceNodeIds, sinkNodeIds } = getConnectedHighlights(sel('B', 'C'), edges);
    expect(sourceNodeIds.has('B')).toBe(false);
    expect(sourceNodeIds.has('C')).toBe(false);
    expect(sinkNodeIds.has('B')).toBe(false);
    expect(sinkNodeIds.has('C')).toBe(false);
  });
});

// ─── ConnectivityMode edge filtering (mirrors DiagramCanvas logic) ────────────
//
// These tests verify the filtering logic that DiagramCanvas applies on top of
// getConnectedHighlights to implement the four ConnectivityMode values.
// We replicate the exact same filter rules here so they're covered without a DOM.

type ConnectivityMode = 'both' | 'only-sources' | 'only-sinks' | 'only-both' | 'none';

function applyMode(
  mode: ConnectivityMode,
  sourceNodeIds: Set<string>,
  sinkNodeIds: Set<string>,
  connectedEdgeIds: Set<string>,
  bidirectionalEdgeIds: Set<string>,
  edgesById: Map<string, EdgeMeta>,
  effectiveSelection: ReadonlySet<string>,
): { shownSources: Set<string>; shownSinks: Set<string>; shownEdges: Set<string> } {
  if (mode === 'none') {
    return { shownSources: new Set(), shownSinks: new Set(), shownEdges: new Set() };
  }
  if (mode === 'only-both') {
    // Mirror DiagramCanvas only-both branch: only bidirectional edges shown,
    // neighbour gets both source and sink highlight.
    const shownSources = new Set<string>();
    const shownSinks   = new Set<string>();
    const shownEdges   = new Set<string>(bidirectionalEdgeIds);
    for (const id of bidirectionalEdgeIds) {
      const e = edgesById.get(id);
      if (!e) continue;
      const { sourceId: src, targetId: tgt } = e;
      const neighbourId = src && !effectiveSelection.has(src) ? src
                        : tgt && !effectiveSelection.has(tgt) ? tgt
                        : null;
      if (neighbourId) { shownSources.add(neighbourId); shownSinks.add(neighbourId); }
    }
    return { shownSources, shownSinks, shownEdges };
  }
  const shownSources = mode !== 'only-sinks'   ? sourceNodeIds : new Set<string>();
  const shownSinks   = mode !== 'only-sources' ? sinkNodeIds   : new Set<string>();
  const shownEdges   = new Set<string>();

  for (const id of connectedEdgeIds) {
    const e = edgesById.get(id);
    if (!e) continue;
    const { sourceId: src, targetId: tgt } = e;
    // For bidirectional edges the source neighbour may be at either end, so
    // check both: src for normal edges, tgt when the edge runs "backwards".
    const isSourceEdge = (src ? shownSources.has(src) : false)
                      || (e.bidirectional && tgt ? shownSources.has(tgt) : false);
    // Mirror DiagramCanvas: for bidirectional edges also check src end against
    // shownSinks (the sink neighbour is at the source end when the edge is flipped).
    const isSinkEdge   = (tgt ? shownSinks.has(tgt) : false)
                      || (e.bidirectional && src ? shownSinks.has(src) : false);
    const isSelfLoop   = src != null && src === tgt && effectiveSelection.has(src);
    if (isSourceEdge || isSinkEdge || isSelfLoop) shownEdges.add(id);
  }
  return { shownSources, shownSinks, shownEdges };
}

describe('ConnectivityMode filtering — A → B → C, selecting B', () => {
  // A --e1--> B --e2--> C
  const edges = [edge('e1', 'A', 'B'), edge('e2', 'B', 'C')];
  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const selection = sel('B');
  const { sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds } = getConnectedHighlights(selection, edges);

  it('mode=both: A highlighted as source, C as sink, both edges shown', () => {
    const { shownSources, shownSinks, shownEdges } = applyMode(
      'both', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection,
    );
    expect([...shownSources]).toEqual(['A']);
    expect([...shownSinks]).toEqual(['C']);
    expect([...shownEdges].sort()).toEqual(['e1', 'e2']);
  });

  it('mode=only-sources: A highlighted, C not; only e1 (A→B) shown', () => {
    const { shownSources, shownSinks, shownEdges } = applyMode(
      'only-sources', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection,
    );
    expect([...shownSources]).toEqual(['A']);
    expect(shownSinks.size).toBe(0);
    expect([...shownEdges]).toEqual(['e1']);
  });

  it('mode=only-sinks: C highlighted, A not; only e2 (B→C) shown', () => {
    const { shownSources, shownSinks, shownEdges } = applyMode(
      'only-sinks', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection,
    );
    expect(shownSources.size).toBe(0);
    expect([...shownSinks]).toEqual(['C']);
    expect([...shownEdges]).toEqual(['e2']);
  });

  it('mode=none: nothing shown', () => {
    const { shownSources, shownSinks, shownEdges } = applyMode(
      'none', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection,
    );
    expect(shownSources.size).toBe(0);
    expect(shownSinks.size).toBe(0);
    expect(shownEdges.size).toBe(0);
  });
});

// ─── bidirectional edges (A <--> B) ─────────────────────────────────────────

describe('getConnectedHighlights — bidirectional edge A <--> B', () => {
  const edges = [biEdge('e1', 'A', 'B')];

  it('selecting B: A is both source AND sink', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('B'), edges);
    expect(sourceNodeIds.has('A')).toBe(true);  // A feeds into B
    expect(sinkNodeIds.has('A')).toBe(true);    // B also feeds into A
    expect(connectedEdgeIds.has('e1')).toBe(true);
  });

  it('selecting A: B is both source AND sink', () => {
    const { sourceNodeIds, sinkNodeIds, connectedEdgeIds } = getConnectedHighlights(sel('A'), edges);
    expect(sourceNodeIds.has('B')).toBe(true);
    expect(sinkNodeIds.has('B')).toBe(true);
    expect(connectedEdgeIds.has('e1')).toBe(true);
  });
});

describe('ConnectivityMode filtering — bidirectional A <--> B, selecting B', () => {
  const edges = [biEdge('e1', 'A', 'B')];
  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const selection = sel('B');
  const { sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds } = getConnectedHighlights(selection, edges);

  it('mode=both: e1 shown', () => {
    const { shownEdges } = applyMode('both', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(shownEdges.has('e1')).toBe(true);
  });

  it('mode=only-sources: e1 shown (A is a source)', () => {
    const { shownEdges } = applyMode('only-sources', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(shownEdges.has('e1')).toBe(true);
  });

  it('mode=only-sinks: e1 shown (A is also a sink)', () => {
    const { shownEdges } = applyMode('only-sinks', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(shownEdges.has('e1')).toBe(true);
  });

  it('mode=only-both: e1 shown (bidirectional)', () => {
    const { shownEdges } = applyMode('only-both', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(shownEdges.has('e1')).toBe(true);
  });

  it('mode=none: e1 hidden', () => {
    const { shownEdges } = applyMode('none', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(shownEdges.has('e1')).toBe(false);
  });
});

describe('ConnectivityMode filtering — self-loop on selected node', () => {
  // A --loop--> A, A --e1--> B
  const edges = [edge('loop', 'A', 'A'), edge('e1', 'A', 'B')];
  const edgesById = new Map(edges.map((e) => [e.id, e]));
  const selection = sel('A');
  const { sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds } = getConnectedHighlights(selection, edges);

  it('self-loop is shown in all non-none modes', () => {
    for (const mode of ['both', 'only-sources', 'only-sinks'] as ConnectivityMode[]) {
      const { shownEdges } = applyMode(
        mode, sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownEdges.has('loop'), `mode=${mode}: self-loop should be shown`).toBe(true);
    }
  });

  it('self-loop is hidden in none mode', () => {
    const { shownEdges } = applyMode(
      'none', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection,
    );
    expect(shownEdges.has('loop')).toBe(false);
  });

  it('e1 (A→B, sink edge) is shown in both and only-sinks, not in only-sources', () => {
    const bothResult = applyMode('both', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(bothResult.shownEdges.has('e1')).toBe(true);

    const sinksResult = applyMode('only-sinks', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(sinksResult.shownEdges.has('e1')).toBe(true);

    const sourcesResult = applyMode('only-sources', sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds, edgesById, selection);
    expect(sourcesResult.shownEdges.has('e1')).toBe(false);
  });
});

// ─── Full scenario: G→H, H→G, G<-->H, H<-->G ───────────────────────────────
//
// e1: G → H  (directed)
// e2: H → G  (directed)
// e3: G <--> H  (bidirectional, source=G target=H)
// e4: H <--> G  (bidirectional, source=H target=G)
//
// Because of the two directed edges AND two bidir edges, H is simultaneously
// a source (feeds G via e2/e4) AND a sink (receives from G via e1/e3) of G,
// and vice-versa.
//
// Expected edges per mode (selecting G, neighbour = H):
//   both          → all four edges shown, H highlighted as both source & sink
//   only-sources  → e2 (H→G directed) + e3/e4 (bidir) shown; e1 (G→H directed) hidden
//   only-sinks    → e1 (G→H directed) + e3/e4 (bidir) shown; e2 (H→G directed) hidden
//   only-both     → e3 + e4 only
//   none          → nothing shown

describe('Full scenario — G→H, H→G, G<-->H, H<-->G', () => {
  const edges = [
    edge  ('e1', 'G', 'H'),   // G → H  (directed)
    edge  ('e2', 'H', 'G'),   // H → G  (directed)
    biEdge('e3', 'G', 'H'),   // G <--> H  (bidirectional)
    biEdge('e4', 'H', 'G'),   // H <--> G  (bidirectional)
  ];
  const edgesById = new Map(edges.map((e) => [e.id, e]));

  // ── select G ──────────────────────────────────────────────────────────────
  describe('selecting G', () => {
    const selection = sel('G');
    const r = getConnectedHighlights(selection, edges);

    it('raw highlights: H is both source AND sink; all four edges connected; e3+e4 are bidirectional', () => {
      expect(r.sourceNodeIds.has('H')).toBe(true);
      expect(r.sinkNodeIds.has('H')).toBe(true);
      expect([...r.connectedEdgeIds].sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
      expect([...r.bidirectionalEdgeIds].sort()).toEqual(['e3', 'e4']);
    });

    it('mode=both: H shown as source AND sink; all four edges shown', () => {
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'both', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.has('H')).toBe(true);
      expect(shownSinks.has('H')).toBe(true);
      expect([...shownEdges].sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
    });

    it('mode=only-sources: H shown as source; e2/e3/e4 shown; directed e1 (G→H) hidden', () => {
      // H is a source neighbour. Edges touching H-as-source:
      //   e2 (H→G directed): src=H ∈ shownSources → shown
      //   e4 (H→G bidir):    src=H ∈ shownSources → shown
      //   e3 (G→H bidir):    tgt=H ∈ shownSources (bidir tgt-check) → shown
      //   e1 (G→H directed): tgt=H but not bidir, src=G not in shownSources → hidden
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'only-sources', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.has('H')).toBe(true);
      expect(shownSinks.size).toBe(0);
      expect(shownEdges.has('e2')).toBe(true);
      expect(shownEdges.has('e3')).toBe(true);
      expect(shownEdges.has('e4')).toBe(true);
      expect(shownEdges.has('e1')).toBe(false);
    });

    it('mode=only-sinks: H shown as sink; e1/e3/e4 shown; directed e2 (H→G) hidden', () => {
      // H is a sink neighbour. Edges touching H-as-sink:
      //   e1 (G→H directed): tgt=H ∈ shownSinks → shown
      //   e3 (G→H bidir):    tgt=H ∈ shownSinks → shown
      //   e4 (H→G bidir):    src=H ∈ shownSinks (bidir src-check) → shown
      //   e2 (H→G directed): src=H but not bidir, tgt=G not in shownSinks → hidden
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'only-sinks', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.size).toBe(0);
      expect(shownSinks.has('H')).toBe(true);
      expect(shownEdges.has('e1')).toBe(true);
      expect(shownEdges.has('e3')).toBe(true);
      expect(shownEdges.has('e4')).toBe(true);
      expect(shownEdges.has('e2')).toBe(false);
    });

    it('mode=only-both: H shown as both; only bidir edges e3+e4; directed e1+e2 hidden', () => {
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'only-both', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.has('H')).toBe(true);
      expect(shownSinks.has('H')).toBe(true);
      expect(shownEdges.has('e3')).toBe(true);
      expect(shownEdges.has('e4')).toBe(true);
      expect(shownEdges.has('e1')).toBe(false);
      expect(shownEdges.has('e2')).toBe(false);
    });

    it('mode=none: nothing shown', () => {
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'none', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.size).toBe(0);
      expect(shownSinks.size).toBe(0);
      expect(shownEdges.size).toBe(0);
    });
  });

  // ── select H ──────────────────────────────────────────────────────────────
  describe('selecting H', () => {
    const selection = sel('H');
    const r = getConnectedHighlights(selection, edges);

    it('raw highlights: G is both source AND sink; all four edges connected; e3+e4 are bidirectional', () => {
      expect(r.sourceNodeIds.has('G')).toBe(true);
      expect(r.sinkNodeIds.has('G')).toBe(true);
      expect([...r.connectedEdgeIds].sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
      expect([...r.bidirectionalEdgeIds].sort()).toEqual(['e3', 'e4']);
    });

    it('mode=both: G shown as source AND sink; all four edges shown', () => {
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'both', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.has('G')).toBe(true);
      expect(shownSinks.has('G')).toBe(true);
      expect([...shownEdges].sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
    });

    it('mode=only-sources: G shown as source; e1/e3/e4 shown; directed e2 (H→G) hidden', () => {
      // G is a source neighbour. Edges touching G-as-source:
      //   e1 (G→H directed): src=G ∈ shownSources → shown
      //   e3 (G→H bidir):    src=G ∈ shownSources → shown
      //   e4 (H→G bidir):    tgt=G ∈ shownSources (bidir tgt-check) → shown
      //   e2 (H→G directed): tgt=G but not bidir, src=H not in shownSources → hidden
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'only-sources', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.has('G')).toBe(true);
      expect(shownSinks.size).toBe(0);
      expect(shownEdges.has('e1')).toBe(true);
      expect(shownEdges.has('e3')).toBe(true);
      expect(shownEdges.has('e4')).toBe(true);
      expect(shownEdges.has('e2')).toBe(false);
    });

    it('mode=only-sinks: G shown as sink; e2/e3/e4 shown; directed e1 (G→H) hidden', () => {
      // G is a sink neighbour. Edges touching G-as-sink:
      //   e2 (H→G directed): tgt=G ∈ shownSinks → shown
      //   e4 (H→G bidir):    tgt=G ∈ shownSinks → shown
      //   e3 (G→H bidir):    src=G ∈ shownSinks (bidir src-check) → shown
      //   e1 (G→H directed): src=G but not bidir, tgt=H not in shownSinks → hidden
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'only-sinks', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.size).toBe(0);
      expect(shownSinks.has('G')).toBe(true);
      expect(shownEdges.has('e2')).toBe(true);
      expect(shownEdges.has('e3')).toBe(true);
      expect(shownEdges.has('e4')).toBe(true);
      expect(shownEdges.has('e1')).toBe(false);
    });

    it('mode=only-both: G shown as both; only bidir edges e3+e4; directed e1+e2 hidden', () => {
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'only-both', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.has('G')).toBe(true);
      expect(shownSinks.has('G')).toBe(true);
      expect(shownEdges.has('e3')).toBe(true);
      expect(shownEdges.has('e4')).toBe(true);
      expect(shownEdges.has('e1')).toBe(false);
      expect(shownEdges.has('e2')).toBe(false);
    });

    it('mode=none: nothing shown', () => {
      const { shownSources, shownSinks, shownEdges } = applyMode(
        'none', r.sourceNodeIds, r.sinkNodeIds, r.connectedEdgeIds, r.bidirectionalEdgeIds, edgesById, selection,
      );
      expect(shownSources.size).toBe(0);
      expect(shownSinks.size).toBe(0);
      expect(shownEdges.size).toBe(0);
    });
  });
});
