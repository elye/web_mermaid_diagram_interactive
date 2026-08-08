/**
 * collapseUtils — pure transformation from a semantic graph (nodes, edges,
 * cluster membership) into the view-graph deltas produced by collapsing one
 * or more subgraph clusters.
 *
 * ### Architecture — semantic vs. view graph
 *
 * The canvas pipeline is split into three layers:
 *
 *   1. **Semantic graph** — extracted once from the Mermaid source:
 *      `NodeMeta[]` (from `extractNodes`), `EdgeMeta[]` (from `extractEdges`),
 *      and the subgraph containment map (from `parseSubgraphMembership`).
 *      This is what the diagram "means", independent of any interactive
 *      view state.
 *
 *   2. **View graph** — the effective graph currently drawn on-screen after
 *      applying interactive transformations (right now: cluster collapse;
 *      future: filters, focus modes, level-of-detail, etc.). The view graph
 *      is derived from the semantic graph + view state and MUST be a pure
 *      function of the two — no DOM reads, no store writes.
 *
 *   3. **Rendering** — DOM effects (`useClusterCollapse` etc.) that project
 *      the view graph onto the live SVG (hide/show elements, draw summary
 *      overlays, inject buttons). Rendering never mutates the view graph.
 *
 * This file owns step 2 for the collapse transformation. Keep it pure so it
 * can be unit-tested in isolation and reused (e.g. by tooltips, export,
 * navigation) without pulling in a DOM.
 */
import type { EdgeMeta } from '@/shared/types/diagram';
import { collectAllNodeIds } from './cluster/subgraphParser';

/**
 * One summary arrow drawn on the canvas to represent one or more real edges
 * whose endpoints were hidden by a collapse.
 *
 * Endpoints are expressed as opaque **string ids** — a bundle endpoint may
 * be either:
 *   - a plain node id (visible node outside any collapsed cluster), or
 *   - a collapsed cluster id (its members are all hidden, so the cluster
 *     itself acts as the endpoint on-screen).
 *
 * The renderer disambiguates by looking the id up in the collapsed-cluster
 * bbox map first, then falling back to the visible-node bbox map.
 */
export interface BundledEdge {
  /** The collapsed cluster this bundle originates from (or terminates at). */
  clusterId: string;
  /**
   * The OTHER endpoint of the bundle. Either a visible node id or another
   * collapsed cluster id.
   */
  externalNodeId: string;
  /**
   * From the perspective of `clusterId`:
   *   - `in`    : edges flow FROM the external endpoint INTO the cluster.
   *   - `out`   : edges flow OUT OF the cluster to the external endpoint.
   *   - `bidir` : at least one merged edge is bidirectional (`<-->`).
   */
  direction: 'in' | 'out' | 'bidir';
  /** How many original edges collapsed into this single summary arrow. */
  count: number;
  /** IDs of the original edges that were merged (for future features / debug). */
  edgeIds: string[];
}

/**
 * Full set of view-graph deltas produced by the current collapse state.
 */
export interface CollapseState {
  /** Node ids that must be hidden (they belong to some collapsed cluster). */
  hiddenNodeIds: Set<string>;
  /**
   * Edge ids whose original path must be hidden (either fully internal to a
   * collapsed cluster, or replaced by a bundled summary arrow).
   */
  hiddenEdgeIds: Set<string>;
  /** Summary arrows to draw in place of the hidden crossing edges. */
  bundledEdges: BundledEdge[];
}

/**
 * Compute the view-graph deltas for a given set of collapsed clusters.
 *
 * @param collapsedClusters  User-facing ids of the currently-collapsed clusters.
 * @param membership         Full subgraph containment map (parseSubgraphMembership).
 * @param edges              The full flat edge list from the semantic graph.
 */
export function computeCollapseState(
  collapsedClusters: ReadonlySet<string>,
  membership: ReadonlyMap<string, ReadonlySet<string>>,
  edges: readonly EdgeMeta[],
): CollapseState {
  const hiddenNodeIds = new Set<string>();
  const hiddenEdgeIds = new Set<string>();
  const bundledEdges: BundledEdge[] = [];

  if (collapsedClusters.size === 0) {
    return { hiddenNodeIds, hiddenEdgeIds, bundledEdges };
  }

  // Build (leafNodeId → owning-collapsed-clusterId) index. If a node belongs
  // to multiple collapsed clusters via nesting, the OUTERMOST collapsed one
  // wins — that's the visual container the user actually sees on screen.
  const leafToCollapsedCluster = buildLeafOwnershipIndex(collapsedClusters, membership);

  // Every leaf inside a collapsed cluster is hidden.
  for (const nodeId of leafToCollapsedCluster.keys()) {
    hiddenNodeIds.add(nodeId);
  }

  // Bundle key → aggregate. Key encodes (fromClusterId, toEndpointId, direction)
  // so parallel/duplicate crossings collapse into a single arrow with a count.
  const bundles = new Map<string, BundledEdge>();

  const bundleKey = (clusterId: string, external: string, dir: 'in' | 'out' | 'bidir') =>
    `${clusterId}::${external}::${dir}`;

  for (const edge of edges) {
    const { id, sourceId, targetId, bidirectional } = edge;
    if (!sourceId || !targetId) continue;

    const srcCluster = leafToCollapsedCluster.get(sourceId) ?? null;
    const tgtCluster = leafToCollapsedCluster.get(targetId) ?? null;

    // Neither endpoint hidden: edge stays as-is.
    if (!srcCluster && !tgtCluster) continue;

    hiddenEdgeIds.add(id);

    // Both endpoints inside the SAME collapsed cluster: purely internal —
    // just hide it, no summary arrow needed.
    if (srcCluster && tgtCluster && srcCluster === tgtCluster) continue;

    // Otherwise this edge crosses at least one collapse boundary. There are
    // three cases:
    //   - src hidden, tgt visible  → cluster → external
    //   - src visible, tgt hidden  → external → cluster
    //   - both hidden (different clusters) → cluster → cluster
    // In every case we emit one bundle per collapsed cluster involved so
    // BOTH clusters get a consistent summary arrow from their point of view.
    // For cluster→cluster we emit a single bundle keyed on the source-side
    // cluster (the other end is the target cluster id acting as external).

    if (srcCluster && !tgtCluster) {
      // out from srcCluster to visible target node
      addBundle(bundles, bundleKey, srcCluster, targetId, bidirectional ? 'bidir' : 'out', id);
    } else if (!srcCluster && tgtCluster) {
      // in from visible source node to tgtCluster
      addBundle(bundles, bundleKey, tgtCluster, sourceId, bidirectional ? 'bidir' : 'in', id);
    } else if (srcCluster && tgtCluster) {
      // cluster → cluster : emit ONE bundle recorded on the SOURCE cluster,
      // with the target cluster acting as the external endpoint. This is
      // sufficient for the renderer, which handles either endpoint being
      // itself a collapsed cluster.
      addBundle(bundles, bundleKey, srcCluster, tgtCluster, bidirectional ? 'bidir' : 'out', id);
    }
  }

  bundledEdges.push(...bundles.values());
  return { hiddenNodeIds, hiddenEdgeIds, bundledEdges };
}

/**
 * Convenience label for a bundle's count badge. Returns `null` when there is
 * exactly one merged edge (no badge needed — a single arrow speaks for itself).
 *
 * Examples: `bundleLabel(1) → null`, `bundleLabel(3) → "×3"`.
 */
export function bundleLabel(count: number): string | null {
  if (count <= 1) return null;
  return `×${count}`;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function addBundle(
  bundles: Map<string, BundledEdge>,
  keyFn: (c: string, e: string, d: 'in' | 'out' | 'bidir') => string,
  clusterId: string,
  externalNodeId: string,
  direction: 'in' | 'out' | 'bidir',
  edgeId: string,
) {
  const key = keyFn(clusterId, externalNodeId, direction);
  const existing = bundles.get(key);
  if (existing) {
    existing.count += 1;
    existing.edgeIds.push(edgeId);
    return;
  }
  bundles.set(key, {
    clusterId,
    externalNodeId,
    direction,
    count: 1,
    edgeIds: [edgeId],
  });
}

/**
 * For each collapsed cluster, resolve its leaf nodes and map every leaf →
 * that cluster. When collapsed clusters are nested, the OUTERMOST collapsed
 * ancestor wins (that's the box actually drawn on screen).
 */
function buildLeafOwnershipIndex(
  collapsedClusters: ReadonlySet<string>,
  membership: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, string> {
  const leafToCluster = new Map<string, string>();

  // Determine which collapsed clusters are OUTERMOST — i.e. not contained in
  // another collapsed cluster. Only these are used to seed leaf ownership so
  // the "outermost wins" invariant holds regardless of iteration order.
  const outermost: string[] = [];
  for (const clusterId of collapsedClusters) {
    if (!hasCollapsedAncestor(clusterId, collapsedClusters, membership)) {
      outermost.push(clusterId);
    }
  }

  // Adapter: `collectAllNodeIds` expects Map<string, Set<string>>; membership
  // may be a ReadonlyMap<string, ReadonlySet<string>>. The runtime types are
  // compatible, so cast at the boundary.
  const mutableMembership = membership as Map<string, Set<string>>;

  for (const clusterId of outermost) {
    const leaves = collectAllNodeIds(clusterId, mutableMembership);
    for (const leaf of leaves) {
      // First-writer wins — safe here because outermost clusters are
      // mutually disjoint by construction (siblings in the containment tree).
      if (!leafToCluster.has(leaf)) leafToCluster.set(leaf, clusterId);
    }
  }
  return leafToCluster;
}

function hasCollapsedAncestor(
  clusterId: string,
  collapsedClusters: ReadonlySet<string>,
  membership: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  // A cluster has a collapsed ancestor iff some OTHER collapsed cluster
  // contains it (directly or transitively).
  for (const other of collapsedClusters) {
    if (other === clusterId) continue;
    if (containsTransitively(other, clusterId, membership)) return true;
  }
  return false;
}

function containsTransitively(
  parentId: string,
  descendantId: string,
  membership: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const stack = [parentId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const members = membership.get(cur);
    if (!members) continue;
    if (members.has(descendantId)) return true;
    for (const m of members) {
      if (membership.has(m)) stack.push(m);
    }
  }
  return false;
}
