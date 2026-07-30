/**
 * .mermaidflow file schema.
 *
 * Version history:
 *   1.0 — initial: source + positions + node styles + annotations + viewport.
 *   1.1 — adds edge waypoints, edge anchor overrides, and edge styles so
 *         reshaped/re-anchored/restyled lines survive save/reload.
 *
 * Loader accepts both; writer emits 1.1.
 */
import type {
  PositionOverride,
  StyleOverride,
  Annotation,
  ViewportState,
  EdgeWaypoint,
  EdgeAnchorOverride,
} from './diagram';

export interface MermaidFlowFileV1 {
  version: '1.0';
  mermaidSource: string;
  positionOverrides: Record<string, PositionOverride>;
  styleOverrides: Record<string, StyleOverride>;
  annotations: Annotation[];
  theme: string;
  viewportState: ViewportState;
  metadata: {
    createdAt: string;
    lastModified: string;
  };
}

export interface MermaidFlowFileV1_1 {
  version: '1.1';
  mermaidSource: string;
  positionOverrides: Record<string, PositionOverride>;
  /** Node style overrides (fill / stroke / …). Same shape as v1.0. */
  styleOverrides: Record<string, StyleOverride>;
  /** Per-edge style overrides (stroke color / width / …). */
  edgeStyles: Record<string, StyleOverride>;
  /** Per-edge list of mid-point waypoints reshaping the curve. */
  edgeWaypoints: Record<string, EdgeWaypoint[]>;
  /** Per-edge pinned source/target anchor sides. */
  edgeAnchorOverrides: Record<string, { source?: EdgeAnchorOverride; target?: EdgeAnchorOverride }>;
  annotations: Annotation[];
  theme: string;
  viewportState: ViewportState;
  metadata: {
    createdAt: string;
    lastModified: string;
  };
}

export type MermaidFlowFile = MermaidFlowFileV1 | MermaidFlowFileV1_1;
