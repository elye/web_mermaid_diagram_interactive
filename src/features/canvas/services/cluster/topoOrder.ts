/**
 * Post-order traversal over the subgraph containment tree so that resizing
 * always processes the deepest nested cluster first — parent clusters must
 * see already-expanded child cluster bboxes when computing their own union.
 */

/**
 * Return subgraph ids in bottom-up order (leaf subgraphs first, root last).
 * Uses a simple post-order DFS over the subgraph containment tree.
 */
export function topoOrder(membership: Map<string, Set<string>>): string[] {
  // Build: child → parent  (a subgraph id that appears as a member of another)
  const childSubgraphs = new Set<string>();
  for (const members of membership.values()) {
    for (const m of members) {
      if (membership.has(m)) childSubgraphs.add(m);
    }
  }
  const roots = [...membership.keys()].filter((id) => !childSubgraphs.has(id));

  const order: string[] = [];
  const visited = new Set<string>();

  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const members = membership.get(id) ?? new Set();
    for (const m of members) {
      if (membership.has(m)) visit(m); // recurse into nested subgraph first
    }
    order.push(id); // post-order: push after children
  }

  for (const root of roots) visit(root);
  // Any unreachable subgraphs (detached, shouldn't happen in valid Mermaid)
  for (const id of membership.keys()) visit(id);

  return order; // leaf → root
}
