/**
 * .mermaidflow file schema.
 */
import type { PositionOverride, StyleOverride, Annotation, ViewportState } from './diagram';

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

export type MermaidFlowFile = MermaidFlowFileV1;
