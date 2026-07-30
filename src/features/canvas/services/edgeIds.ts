/**
 * Decoders for Mermaid's internal id conventions.
 *
 * Node ids look like `flowchart-A-0`, `state-Init-2`, etc. — a diagram
 * type prefix, the user-defined id, and a render counter. Edge ids look
 * like `L-<source>-<target>-<n>` (current) or `L_<source>_<target>_<n>`
 * (older). The tricky part is that user ids may themselves contain the
 * separator character, so we resolve ambiguity by testing every possible
 * split against a set of known node ids.
 *
 * These helpers are pure string ops — no DOM required — so they are
 * trivial to unit-test.
 */

const NODE_PREFIX_RE = /^(?:flowchart|node|state|classGroup|class|er|sequence)-/;
const TRAILING_COUNTER_RE = /-\d+$/;

/**
 * Extract the user-defined node id from Mermaid's mangled DOM id.
 * Example: `flowchart-A-0` → `A`.
 */
export function extractUserNodeId(rawId: string): string {
  return rawId.replace(NODE_PREFIX_RE, '').replace(TRAILING_COUNTER_RE, '');
}

/**
 * Decode source/target node ids from an edge id.
 *
 * Returns `null` if the id doesn't match either supported convention.
 * When the id is ambiguous (a user id contains the separator character),
 * we prefer the split where BOTH halves are present in `knownIds`; if no
 * such split exists we fall back to "everything before the first
 * separator is the source".
 */
export function extractEdgeEndpoints(
  edgeId: string,
  knownIds: ReadonlySet<string>,
): { source: string; target: string } | null {
  const parsed = stripEdgePrefixAndCounter(edgeId);
  if (!parsed) return null;
  const { inner, sep } = parsed;

  const parts = inner.split(sep);
  for (let i = 1; i < parts.length; i += 1) {
    const source = parts.slice(0, i).join(sep);
    const target = parts.slice(i).join(sep);
    if (knownIds.has(source) && knownIds.has(target)) {
      return { source, target };
    }
  }

  // Fallback for edges whose nodes aren't in the DOM yet, or for id shapes
  // we haven't seen before: take the shortest possible source.
  if (parts.length >= 2) {
    return { source: parts[0], target: parts.slice(1).join(sep) };
  }
  return null;
}

function stripEdgePrefixAndCounter(
  edgeId: string,
): { inner: string; sep: '-' | '_' } | null {
  const dashM = /^L-(.+)-\d+$/.exec(edgeId);
  if (dashM) return { inner: dashM[1], sep: '-' };
  const underM = /^L_(.+)_\d+$/.exec(edgeId);
  if (underM) return { inner: underM[1], sep: '_' };
  return null;
}
