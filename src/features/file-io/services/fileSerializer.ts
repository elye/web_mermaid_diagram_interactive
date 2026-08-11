/**
 * fileSerializer — collects current app state into a .mermaidflow blob.
 */
import type { MermaidFlowFile } from '@/shared/types/file';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useUiStore } from '@/stores/uiStore';

export function buildFileObject(): MermaidFlowFile {
  const d = useDiagramStore.getState();
  const s = useStyleStore.getState();
  const u = useUiStore.getState();
  const now = new Date().toISOString();
  return {
    version: '1.2',
    mermaidSource: d.source,
    positionOverrides: d.positionOverrides,
    styleOverrides: s.nodeStyles,
    edgeStyles: s.edgeStyles,
    edgeWaypoints: d.edgeWaypoints,
    edgeAnchorOverrides: d.edgeAnchorOverrides,
    clusterStyles: s.clusterStyles,
    annotations: s.annotations,
    collapsedClusters: Array.from(d.collapsedClusters),
    theme: u.theme,
    viewportState: u.viewport,
    metadata: { createdAt: now, lastModified: now },
  };
}

export function serializeToFile(): Blob {
  const obj = buildFileObject();
  return new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
}

export function serializeToJson(): string {
  return JSON.stringify(buildFileObject());
}
