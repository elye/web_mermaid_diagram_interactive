/**
 * DiagramTooltip — a positioned tooltip that appears after a brief hover pause
 * over a node or edge in the canvas.
 *
 * For nodes:  shows node name + lists of source / sink / bidirectional neighbours
 *             (up to 10 each; … when more exist).
 * For edges:  shows edge label (if any) + the source and target node names.
 *
 * Rendered in a React portal so it sits above all canvas transforms.
 */
import { createPortal } from 'react-dom';
import type { EdgeMeta, NodeMeta } from '@/shared/types/diagram';

const MAX_NAMES = 10;

export interface NodeTooltipInfo {
  kind: 'node';
  nodeId: string;
  label: string;
  /** Labels of upstream source nodes (up to MAX_NAMES). */
  sourceNames: string[];
  /** True when there are more than MAX_NAMES sources. */
  sourceOverflow: boolean;
  /** Labels of downstream sink nodes (up to MAX_NAMES). */
  sinkNames: string[];
  sinkOverflow: boolean;
  /** Labels of bidirectionally connected nodes (up to MAX_NAMES). */
  bidirNames: string[];
  bidirOverflow: boolean;
  x: number;
  y: number;
}

export interface EdgeTooltipInfo {
  kind: 'edge';
  edgeId: string;
  label: string | null;
  sourceName: string | null;
  targetName: string | null;
  /** True when the edge has arrows on both ends (e.g. A <--> B). */
  bidirectional?: boolean;
  x: number;
  y: number;
}

export type TooltipInfo = NodeTooltipInfo | EdgeTooltipInfo;

interface Props {
  info: TooltipInfo;
}

export function DiagramTooltip({ info }: Props) {
  const OFFSET = 12;

  const style: React.CSSProperties = {
    left: info.x + OFFSET,
    top: info.y + OFFSET,
  };

  return createPortal(
    <div className="mf-tooltip" style={style} role="tooltip">
      {info.kind === 'node' ? (
        <NodeTooltipContent info={info} />
      ) : (
        <EdgeTooltipContent info={info} />
      )}
    </div>,
    document.body,
  );
}

function NodeTooltipContent({ info }: { info: NodeTooltipInfo }) {
  return (
    <>
      <div className="mf-tooltip__title">{info.label || info.nodeId}</div>
      {(info.sourceNames.length > 0 || info.sourceOverflow) && (
        <ConnGroup color="amber" label="Sources" names={info.sourceNames} overflow={info.sourceOverflow} />
      )}
      {(info.sinkNames.length > 0 || info.sinkOverflow) && (
        <ConnGroup color="violet" label="Sinks" names={info.sinkNames} overflow={info.sinkOverflow} />
      )}
      {(info.bidirNames.length > 0 || info.bidirOverflow) && (
        <ConnGroup color="teal" label="Bidir ⇔" names={info.bidirNames} overflow={info.bidirOverflow} />
      )}
    </>
  );
}

function ConnGroup({
  color,
  label,
  names,
  overflow,
}: {
  color: 'amber' | 'violet' | 'teal';
  label: string;
  names: string[];
  overflow: boolean;
}) {
  return (
    <div className="mf-tooltip__conn-group">
      <span className={`mf-tooltip__conn-header mf-tooltip__conn-header--${color}`}>
        {label}
        <span className="mf-tooltip__conn-count">({names.length}{overflow ? '+' : ''})</span>
      </span>
      <ul className="mf-tooltip__conn-list">
        {names.map((n) => (
          <li key={n} className={`mf-tooltip__conn-item mf-tooltip__conn-item--${color}`}>{n}</li>
        ))}
        {overflow && <li className="mf-tooltip__conn-more">…</li>}
      </ul>
    </div>
  );
}

function EdgeTooltipContent({ info }: { info: EdgeTooltipInfo }) {
  return (
    <>
      {info.label && <div className="mf-tooltip__title">{info.label}</div>}
      <div className="mf-tooltip__edge-endpoints">
        <span className="mf-tooltip__endpoint mf-tooltip__endpoint--source">
          {info.sourceName ?? '?'}
        </span>
        <span className="mf-tooltip__arrow">{info.bidirectional ? '↔' : '→'}</span>
        <span className="mf-tooltip__endpoint mf-tooltip__endpoint--target">
          {info.targetName ?? '?'}
        </span>
      </div>
    </>
  );
}



// ─── Helpers used by DiagramCanvas ────────────────────────────────────────────

/**
 * Given a node id, collect the labels of its incoming (source), outgoing (sink),
 * and bidirectional neighbours, capped at MAX_NAMES each.
 */
export function computeNodeConnections(
  nodeId: string,
  edges: readonly EdgeMeta[],
  nodes: readonly NodeMeta[],
): {
  sourceNames: string[]; sourceOverflow: boolean;
  sinkNames: string[];   sinkOverflow: boolean;
  bidirNames: string[];  bidirOverflow: boolean;
} {
  const nodeLabel = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;

  const allSources: string[] = [];
  const allSinks: string[] = [];
  const allBidir: string[] = [];

  for (const edge of edges) {
    const { sourceId, targetId, bidirectional } = edge;
    if (!sourceId || !targetId) continue;

    if (bidirectional && (sourceId === nodeId || targetId === nodeId)) {
      const neighbour = sourceId === nodeId ? targetId : sourceId;
      allBidir.push(nodeLabel(neighbour));
      continue;
    }
    if (targetId === nodeId) allSources.push(nodeLabel(sourceId));
    if (sourceId === nodeId) allSinks.push(nodeLabel(targetId));
  }

  return {
    sourceNames: allSources.slice(0, MAX_NAMES),
    sourceOverflow: allSources.length > MAX_NAMES,
    sinkNames: allSinks.slice(0, MAX_NAMES),
    sinkOverflow: allSinks.length > MAX_NAMES,
    bidirNames: allBidir.slice(0, MAX_NAMES),
    bidirOverflow: allBidir.length > MAX_NAMES,
  };
}

/**
 * Given an edge id, return its label text (extracted from the SVG DOM)
 * and the display labels of its source/target nodes.
 */
export function computeEdgeTooltipInfo(
  edgeId: string,
  edges: readonly EdgeMeta[],
  nodes: readonly NodeMeta[],
  svgHost: HTMLElement | null,
): { label: string | null; sourceName: string | null; targetName: string | null; bidirectional: boolean } {
  const edgeMeta = edges.find((e) => e.id === edgeId);

  const nodeName = (id: string | null): string | null => {
    if (!id) return null;
    return nodes.find((n) => n.id === id)?.label ?? id;
  };

  // Extract edge label text from SVG: the annotated g.edgeLabel carries
  // data-edge-id, and its text content is the label.
  let label: string | null = null;
  if (svgHost) {
    const labelEl = svgHost.querySelector<SVGGElement>(
      `g.edgeLabel[data-edge-id="${CSS.escape(edgeId)}"]`,
    );
    if (labelEl) {
      const text = labelEl.textContent?.trim();
      if (text) label = text;
    }
  }

  return {
    label,
    sourceName: nodeName(edgeMeta?.sourceId ?? null),
    targetName: nodeName(edgeMeta?.targetId ?? null),
    bidirectional: edgeMeta?.bidirectional ?? false,
  };
}
