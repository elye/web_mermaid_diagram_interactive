/**
 * graphTraversal — computes source/sink highlights for a set of selected nodes.
 *
 * Given a selection and a flat list of EdgeMeta, returns:
 *   - sourceNodeIds: nodes that have an edge pointing INTO a selected node
 *   - sinkNodeIds:   nodes that a selected node has an edge pointing OUT TO
 *   - connectedEdgeIds: edges that link selected nodes to their source/sink neighbors
 *
 * Nodes that are themselves selected are excluded from sourceNodeIds/sinkNodeIds
 * (they belong to the selection ring, not the highlight ring).
 *
 * Pure function — no DOM, no store access.
 */
import type { EdgeMeta } from '@/shared/types/diagram';

export interface ConnectedHighlights {
  sourceNodeIds: Set<string>;
  sinkNodeIds: Set<string>;
  connectedEdgeIds: Set<string>;
}

/**
 * Compute which neighboring nodes and edges should be highlighted
 * when `selectedIds` is the current selection.
 *
 * @param selectedIds  The set of currently selected node IDs.
 * @param edges        All edges in the diagram (from diagramStore).
 */
export function getConnectedHighlights(
  selectedIds: ReadonlySet<string>,
  edges: readonly EdgeMeta[],
): ConnectedHighlights {
  const sourceNodeIds = new Set<string>();
  const sinkNodeIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();

  if (selectedIds.size === 0) {
    return { sourceNodeIds, sinkNodeIds, connectedEdgeIds };
  }

  for (const edge of edges) {
    const { id, sourceId, targetId, bidirectional } = edge;
    if (!sourceId || !targetId) continue;

    const sourceSelected = selectedIds.has(sourceId);
    const targetSelected = selectedIds.has(targetId);

    if (sourceSelected && targetSelected) {
      // Both ends are selected — the edge is part of the selection itself,
      // but we still mark it as connected for the edge highlight.
      connectedEdgeIds.add(id);
      continue;
    }

    if (targetSelected && !sourceSelected) {
      // An edge flows INTO a selected node → sourceId is an upstream source.
      sourceNodeIds.add(sourceId);
      connectedEdgeIds.add(id);
      if (bidirectional) {
        // Bidirectional edge also flows OUT OF the selected node → sourceId
        // is simultaneously a downstream sink (B feeds into A as well).
        sinkNodeIds.add(sourceId);
      }
    }

    if (sourceSelected && !targetSelected) {
      // An edge flows OUT OF a selected node → targetId is a downstream sink.
      sinkNodeIds.add(targetId);
      connectedEdgeIds.add(id);
      if (bidirectional) {
        // Bidirectional edge also flows INTO the selected node → targetId
        // is simultaneously an upstream source.
        sourceNodeIds.add(targetId);
      }
    }
  }

  return { sourceNodeIds, sinkNodeIds, connectedEdgeIds };
}
