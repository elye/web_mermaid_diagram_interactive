/**
 * diagramStore
 * ------------
 * Owns the Mermaid source code, the last-rendered SVG, extracted node metadata,
 * and per-node position overrides applied on top of the auto layout.
 *
 * Public actions:
 *   - setSource(src)              — update Mermaid source (from editor or file)
 *   - setRendered({ svg, nodes })  — after render engine completes
 *   - setPositionOverride(id, p)  — user dragged node
 *   - clearPositionOverrides()
 *   - deleteNodes(ids)            — remove nodes from source (best-effort)
 *   - hydrate(state)              — used by file load & autosave restore
 */
import { create } from 'zustand';
import { DEFAULT_MERMAID_SOURCE } from '@/shared/constants/defaults';
import type { NodeMeta, EdgeMeta, PositionOverride, EdgeWaypoint, EdgeAnchorOverride } from '@/shared/types/diagram';
import { parseSubgraphMembership } from '@/features/canvas/services/cluster/subgraphParser';

/**
 * Collect all nested subgraph ids that are direct or indirect children of
 * `clusterId` in the membership map (breadth-first).
 */
function collectNestedSubclusters(
  clusterId: string,
  membership: Map<string, Set<string>>,
): string[] {
  const result: string[] = [];
  const queue = [clusterId];
  while (queue.length) {
    const current = queue.shift()!;
    const members = membership.get(current);
    if (!members) continue;
    for (const m of members) {
      if (membership.has(m)) {
        result.push(m);
        queue.push(m);
      }
    }
  }
  return result;
}

export interface DiagramState {
  source: string;
  svg: string;
  nodes: NodeMeta[];
  edges: EdgeMeta[];
  positionOverrides: Record<string, PositionOverride>;
  /** Per-edge list of user-dragged waypoints (control points).
   *  Each entry is a single mid-point; future work may support n > 1. */
  edgeWaypoints: Record<string, EdgeWaypoint[]>;
  /**
   * Per-edge anchor overrides: { [edgeId]: { source?: override, target?: override } }
   * Allows the user to pin arrow attachment points to a specific side of the node.
   */
  edgeAnchorOverrides: Record<string, { source?: EdgeAnchorOverride; target?: EdgeAnchorOverride }>;
  /**
   * Ids of subgraph clusters currently rendered in collapsed form.
   *
   * Collapse is a **view-state** toggle — it does NOT change the semantic
   * graph (nodes / edges / membership) and is excluded from undo/redo.
   * However, it IS persisted via autosave so that expand/collapse state
   * survives page refreshes.
   */
  collapsedClusters: Set<string>;
  renderError: string | null;

  setSource: (src: string) => void;
  setRendered: (payload: { svg: string; nodes: NodeMeta[]; edges: EdgeMeta[] }) => void;
  setRenderError: (err: string | null) => void;
  setPositionOverride: (id: string, p: PositionOverride) => void;
  clearPositionOverrides: () => void;
  setEdgeWaypoints: (edgeId: string, points: EdgeWaypoint[]) => void;
  clearEdgeWaypoints: (edgeId?: string) => void;
  setEdgeAnchorOverride: (edgeId: string, role: 'source' | 'target', override: EdgeAnchorOverride | null) => void;
  clearEdgeAnchorOverrides: (edgeId?: string) => void;
  /** Toggle a cluster's collapse state (view-only; not tracked by history). */
  toggleClusterCollapse: (clusterId: string) => void;
  /** Explicitly set (or clear) a cluster's collapse state. */
  setClusterCollapsed: (clusterId: string, collapsed: boolean) => void;
  /** Expand every currently-collapsed cluster. */
  expandAllClusters: () => void;
  /** Collapse every subgraph cluster found in the current source. */
  collapseAllClusters: () => void;
  /** Expand a cluster and all of its collapsed descendants. */
  expandClusterAndDescendants: (clusterId: string) => void;
  deleteNodes: (ids: string[]) => void;
  hydrate: (patch: Partial<DiagramState>) => void;
}

export const useDiagramStore = create<DiagramState>((set) => ({
  source: DEFAULT_MERMAID_SOURCE,
  svg: '',
  nodes: [],
  edges: [],
  positionOverrides: {},
  edgeWaypoints: {},
  edgeAnchorOverrides: {},
  collapsedClusters: new Set<string>(),
  renderError: null,

  setSource: (src) =>
    set((s) => ({
      source: src,
      renderError: null,
      // Collapse state references cluster ids that may not exist in the new
      // source — clear it so we never carry stale ids across an edit. The
      // user can re-collapse after the new render lands.
      collapsedClusters: s.collapsedClusters.size === 0 ? s.collapsedClusters : new Set<string>(),
    })),
  setRendered: ({ svg, nodes, edges }) => set({ svg, nodes, edges, renderError: null }),
  setRenderError: (err) => set({ renderError: err }),
  setPositionOverride: (id, p) =>
    set((s) => ({ positionOverrides: { ...s.positionOverrides, [id]: p } })),
  clearPositionOverrides: () => set({ positionOverrides: {} }),
  setEdgeWaypoints: (edgeId, points) =>
    set((s) => ({ edgeWaypoints: { ...s.edgeWaypoints, [edgeId]: points } })),
  clearEdgeWaypoints: (edgeId) =>
    set((s) => {
      if (!edgeId) return { edgeWaypoints: {} };
      const next = { ...s.edgeWaypoints };
      delete next[edgeId];
      return { edgeWaypoints: next };
    }),
  setEdgeAnchorOverride: (edgeId, role, override) =>
    set((s) => {
      const existing = s.edgeAnchorOverrides[edgeId] ?? {};
      if (override === null) {
        const next = { ...existing };
        delete next[role];
        return { edgeAnchorOverrides: { ...s.edgeAnchorOverrides, [edgeId]: next } };
      }
      return {
        edgeAnchorOverrides: {
          ...s.edgeAnchorOverrides,
          [edgeId]: { ...existing, [role]: override },
        },
      };
    }),
  clearEdgeAnchorOverrides: (edgeId) =>
    set((s) => {
      if (!edgeId) return { edgeAnchorOverrides: {} };
      const next = { ...s.edgeAnchorOverrides };
      delete next[edgeId];
      return { edgeAnchorOverrides: next };
    }),
  toggleClusterCollapse: (clusterId) =>
    set((s) => {
      const next = new Set(s.collapsedClusters);
      const membership = parseSubgraphMembership(s.source);
      if (next.has(clusterId)) {
        // Expanding: only remove this cluster itself.
        // Nested sub-clusters remain collapsed so the user expands level by
        // level — clicking Outer reveals Inner as a 120x40 collapsed box.
        next.delete(clusterId);
      } else {
        // Collapsing: add this cluster and all nested sub-clusters so that
        // everything inside is hidden under the single collapsed box.
        const nested = collectNestedSubclusters(clusterId, membership);
        next.add(clusterId);
        for (const id of nested) next.add(id);
      }
      // Clear bundle edgeWaypoints for this cluster — they become stale when
      // the collapse state changes (new bundles may appear or disappear).
      const nextEdgeWaypoints: Record<string, EdgeWaypoint[]> = {};
      for (const [k, v] of Object.entries(s.edgeWaypoints)) {
        if (!k.startsWith(`${clusterId}::`)) nextEdgeWaypoints[k] = v;
      }
      return { collapsedClusters: next, edgeWaypoints: nextEdgeWaypoints };
    }),
  setClusterCollapsed: (clusterId, collapsed) =>
    set((s) => {
      const alreadyCollapsed = s.collapsedClusters.has(clusterId);
      if (alreadyCollapsed === collapsed) return {};
      const next = new Set(s.collapsedClusters);
      const membership = parseSubgraphMembership(s.source);
      if (collapsed) {
        // Collapsing: add this cluster and all its nested sub-clusters.
        const nested = collectNestedSubclusters(clusterId, membership);
        next.add(clusterId);
        for (const id of nested) next.add(id);
      } else {
        // Expanding: only remove this cluster itself (single-level).
        next.delete(clusterId);
      }
      return { collapsedClusters: next };
    }),
  expandAllClusters: () =>
    set((s) => (s.collapsedClusters.size === 0 ? {} : { collapsedClusters: new Set<string>() })),
  collapseAllClusters: () =>
    set((s) => {
      const membership = parseSubgraphMembership(s.source);
      if (membership.size === 0) return {};
      // Collapse every subgraph (including nested ones).
      const allClusterIds = new Set<string>(membership.keys());
      // Early-out if already all collapsed.
      if (allClusterIds.size === s.collapsedClusters.size &&
          [...allClusterIds].every((id) => s.collapsedClusters.has(id))) {
        return {};
      }
      return { collapsedClusters: allClusterIds };
    }),
  expandClusterAndDescendants: (clusterId) =>
    set((s) => {
      const membership = parseSubgraphMembership(s.source);
      const toRemove = new Set([clusterId, ...collectNestedSubclusters(clusterId, membership)]);
      const next = new Set(s.collapsedClusters);
      for (const id of toRemove) next.delete(id);
      return next.size === s.collapsedClusters.size ? {} : { collapsedClusters: next };
    }),
  deleteNodes: (ids) =>
    set((s) => ({
      source: removeNodesFromSource(s.source, ids),
    })),
  hydrate: (patch) => set(patch),
}));

/**
 * Best-effort: strips lines that begin with an ID from `ids`.
 * A full source rewriter is out of scope for the initial pass.
 */
function removeNodesFromSource(source: string, ids: string[]): string {
  if (!ids.length) return source;
  const idSet = new Set(ids);
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      const firstToken = trimmed.split(/[\s\[({>=\-]/)[0];
      return !idSet.has(firstToken);
    })
    .join('\n');
}
