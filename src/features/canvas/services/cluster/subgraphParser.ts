/**
 * Parses Mermaid flowchart/graph source to determine which node ids (and
 * nested subgraph ids) belong to which `subgraph` block. This is the only
 * way to recover cluster membership — Mermaid's rendered SVG does not nest
 * node `<g>` elements inside their cluster `<g>` (see `../../clusterResize.ts`
 * header comment for the DOM layout rationale).
 */

/**
 * Parse Mermaid flowchart/graph source and return a map of
 *   subgraphId → Set<memberIds>
 * where memberIds includes both plain node ids and nested subgraph ids.
 *
 * Handles arbitrarily deep nesting by maintaining a stack of open subgraphs.
 *
 * Only flowchart / graph diagrams use `subgraph` syntax. For other diagram
 * types the function returns an empty map (no-op).
 */
export function parseSubgraphMembership(source: string): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const stack: string[] = []; // stack of open subgraph ids (innermost last)

  const lines = source.split('\n');
  for (const raw of lines) {
    const line = raw.trim();

    // `subgraph [id] [title]`  — three forms:
    //   subgraph myId[My Title]
    //   subgraph myId
    //   subgraph   (anonymous — Mermaid auto-generates an id)
    const subgraphMatch =
      /^subgraph\s+([A-Za-z0-9_\-"]+)\s*(?:\[.*\])?/.exec(line) ??
      /^subgraph\s*$/.exec(line);
    if (subgraphMatch) {
      // Extract id: first capture group if present, else use a generated placeholder.
      const rawId = subgraphMatch[1]?.replace(/^"|"$/g, '') ?? `__anon_${result.size}`;
      result.set(rawId, new Set());
      // If there is an enclosing subgraph, register this sub as a member.
      if (stack.length > 0) {
        result.get(stack[stack.length - 1])!.add(rawId);
      }
      stack.push(rawId);
      continue;
    }

    if (/^end\s*$/.test(line) || /^end\b/.test(line)) {
      stack.pop();
      continue;
    }

    // Only collect node references when inside at least one subgraph.
    if (stack.length === 0) continue;

    const currentSub = stack[stack.length - 1];

    // Edge declaration lines: `A --> B`, `A -->|label| B`, `A & B --> C`, etc.
    // We just want every identifier that appears as a standalone word.
    const nodeIds = extractNodeIds(line);
    for (const nid of nodeIds) {
      result.get(currentSub)!.add(nid);
    }
  }

  return result;
}

/**
 * Extract all node identifiers from a single line of Mermaid source.
 * This is intentionally broad — it picks up node ids from edge declarations
 * (`A --> B --> C`) and standalone declarations (`A[label]`).
 * Keywords and punctuation are filtered out.
 */
function extractNodeIds(line: string): string[] {
  // Strip inline labels: A[My Label] → A, A{diamond} → A, A((circle)) → A
  const stripped = line
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\([^)]*\)/g, '');

  // Tokenise by whitespace and common edge decorators.
  const tokens = stripped.split(/[\s\-|>&<]+/);
  const KEYWORDS = new Set([
    '', 'graph', 'flowchart', 'LR', 'RL', 'TD', 'TB', 'BT',
    'subgraph', 'end', 'direction', 'click', 'style', 'classDef',
    'class', 'linkStyle', 'note', 'participant', 'actor', 'loop',
    'alt', 'else', 'opt', 'par', 'and', 'critical', 'option', 'break',
  ]);
  return tokens.filter((t) => t.length > 0 && !KEYWORDS.has(t) && /^[A-Za-z0-9_\-"]+$/.test(t));
}
