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
    version: '1.0',
    mermaidSource: d.source,
    positionOverrides: d.positionOverrides,
    styleOverrides: s.nodeStyles,
    annotations: s.annotations,
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
