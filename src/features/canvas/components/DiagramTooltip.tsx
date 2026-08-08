/**
 * DiagramTooltip — a positioned tooltip that appears after a brief hover pause
 * over a node or edge in the canvas.
 *
 * For nodes:  shows node name + lists of source / sink / bidirectional neighbours
 *             (up to 20 each; … when more exist, shown side-by-side in columns).
 * For edges:  shows edge label (if any) + the source and target node names.
 *
 * Rendered in a React portal so it sits above all canvas transforms.
 */
import { createPortal } from 'react-dom';
import type { EdgeMeta, NodeMeta } from '@/shared/types/diagram';

const MAX_NAMES = 20;

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

/**
 * Tooltip shown when hovering a **collapsed cluster**. Summarises how many
 * member nodes are hidden and what the cluster is connected to on the outside.
 */
export interface CollapsedClusterTooltipInfo {
  kind: 'collapsed-cluster';
  clusterId: string;
  memberCount: number;
  sourceNames: string[];
  sourceOverflow: boolean;
  sinkNames: string[];
  sinkOverflow: boolean;
  bidirNames: string[];
  bidirOverflow: boolean;
  x: number;
  y: number;
}

/**
 * Tooltip shown when hovering a **bundled summary arrow** drawn by the
 * collapse renderer. Explains how many real edges were merged and in which
 * direction they run.
 */
export interface BundledEdgeTooltipInfo {
  kind: 'bundled-edge';
  clusterId: string;
  externalNodeLabel: string;
  direction: 'in' | 'out' | 'bidir';
  count: number;
  x: number;
  y: number;
}

export type TooltipInfo =
  | NodeTooltipInfo
  | EdgeTooltipInfo
  | CollapsedClusterTooltipInfo
  | BundledEdgeTooltipInfo;

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
      {info.kind === 'node' && <NodeTooltipContent info={info} />}
      {info.kind === 'edge' && <EdgeTooltipContent info={info} />}
      {info.kind === 'collapsed-cluster' && <CollapsedClusterTooltipContent info={info} />}
      {info.kind === 'bundled-edge' && <BundledEdgeTooltipContent info={info} />}
    </div>,
    document.body,
  );
}

function NodeTooltipContent({ info }: { info: NodeTooltipInfo }) {
  const hasSource = info.sourceNames.length > 0 || info.sourceOverflow;
  const hasSink   = info.sinkNames.length   > 0 || info.sinkOverflow;
  const hasBidir  = info.bidirNames.length  > 0 || info.bidirOverflow;
  const colCount  = (hasSource ? 1 : 0) + (hasSink ? 1 : 0) + (hasBidir ? 1 : 0);
  return (
    <>
      <div className="mf-tooltip__title">{info.label || info.nodeId}</div>
      <div className="mf-tooltip__columns" data-cols={colCount}>
        {hasSource && (
          <ConnGroup color="amber" label="Sources" names={info.sourceNames} overflow={info.sourceOverflow} />
        )}
        {hasSink && (
          <ConnGroup color="violet" label="Sinks" names={info.sinkNames} overflow={info.sinkOverflow} />
        )}
        {hasBidir && (
          <ConnGroup color="teal" label="Bidir ⇔" names={info.bidirNames} overflow={info.bidirOverflow} />
        )}
      </div>
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

function CollapsedClusterTooltipContent({ info }: { info: CollapsedClusterTooltipInfo }) {
  const hasSource = info.sourceNames.length > 0 || info.sourceOverflow;
  const hasSink   = info.sinkNames.length   > 0 || info.sinkOverflow;
  const hasBidir  = info.bidirNames.length  > 0 || info.bidirOverflow;
  const colCount  = (hasSource ? 1 : 0) + (hasSink ? 1 : 0) + (hasBidir ? 1 : 0);
  return (
    <>
      <div className="mf-tooltip__title">
        {info.clusterId}
        <span className="mf-tooltip__cluster-count">
          ({info.memberCount} node{info.memberCount === 1 ? '' : 's'} collapsed)
        </span>
      </div>
      {colCount > 0 && (
        <div className="mf-tooltip__columns" data-cols={colCount}>
          {hasSource && (
            <ConnGroup color="amber" label="Sources" names={info.sourceNames} overflow={info.sourceOverflow} />
          )}
          {hasSink && (
            <ConnGroup color="violet" label="Sinks" names={info.sinkNames} overflow={info.sinkOverflow} />
          )}
          {hasBidir && (
            <ConnGroup color="teal" label="Bidir ⇔" names={info.bidirNames} overflow={info.bidirOverflow} />
          )}
        </div>
      )}
    </>
  );
}

function BundledEdgeTooltipContent({ info }: { info: BundledEdgeTooltipInfo }) {
  // Arrow rendering matches the direction of the summary arrow drawn on canvas:
  //   in    :  external → cluster
  //   out   :  cluster → external
  //   bidir :  cluster ↔ external
  const arrow = info.direction === 'bidir' ? '↔' : '→';
  const [left, right] =
    info.direction === 'in'
      ? [info.externalNodeLabel, info.clusterId]
      : [info.clusterId, info.externalNodeLabel];
  return (
    <>
      <div className="mf-tooltip__title">
        Bundled edge
        <span className="mf-tooltip__cluster-count">
          ({info.count} edge{info.count === 1 ? '' : 's'} merged)
        </span>
      </div>
      <div className="mf-tooltip__edge-endpoints">
        <span className="mf-tooltip__endpoint mf-tooltip__endpoint--source">{left}</span>
        <span className="mf-tooltip__arrow">{arrow}</span>
        <span className="mf-tooltip__endpoint mf-tooltip__endpoint--target">{right}</span>
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
