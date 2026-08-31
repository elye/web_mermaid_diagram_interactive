/**
 * fileParser — recognises `.mmd`, `.mermaid`, `.mermaidflow` payloads and
 * hydrates the stores accordingly. Returns { kind, ok } describing the outcome.
 */
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useUiStore } from '@/stores/uiStore';
import type { MermaidFlowFile } from '@/shared/types/file';

export type ParseResult =
  | { kind: 'mermaid'; ok: true }
  | { kind: 'mermaidflow'; ok: true }
  | { kind: 'unknown'; ok: false; error: string };

export function loadFromText(text: string, filename?: string): ParseResult {
  const ext = filename?.toLowerCase().split('.').pop() ?? '';
  const looksJson = text.trimStart().startsWith('{');

  if (ext === 'mermaidflow' || looksJson) {
    try {
      const parsed = JSON.parse(text) as MermaidFlowFile;
      const supported = parsed.version === '1.0' || parsed.version === '1.1' || parsed.version === '1.2';
      if (!supported || typeof parsed.mermaidSource !== 'string') {
        return { kind: 'unknown', ok: false, error: 'Unsupported .mermaidflow version.' };
      }
      hydrateFromFile(parsed);
      return { kind: 'mermaidflow', ok: true };
    } catch (e) {
      return {
        kind: 'unknown',
        ok: false,
        error: e instanceof Error ? e.message : 'Invalid JSON.',
      };
    }
  }

  // Treat as raw Mermaid.
  useDiagramStore.getState().hydrate({
    source: text,
    positionOverrides: {},
  });
  useStyleStore.getState().reset();
  return { kind: 'mermaid', ok: true };
}

export function hydrateFromFile(file: MermaidFlowFile): void {
  // v1.1 adds edgeStyles / edgeWaypoints / edgeAnchorOverrides.
  // v1.2 adds clusterStyles and (optionally) collapsedClusters.
  // Older files simply omit new fields → treated as empty maps.
  const isV11orHigher = file.version === '1.1' || file.version === '1.2';
  const isV12 = file.version === '1.2';

  // Restore collapsed clusters from file (v1.2 only).
  // The field is an array in JSON; we convert it back to a Set for the store.
  const collapsedArray = isV12
    ? (file as { collapsedClusters?: string[] }).collapsedClusters ?? []
    : [];

  useDiagramStore.getState().hydrate({
    source: file.mermaidSource,
    positionOverrides: file.positionOverrides ?? {},
    edgeWaypoints: isV11orHigher ? (file as { edgeWaypoints?: {} }).edgeWaypoints ?? {} : {},
    edgeAnchorOverrides: isV11orHigher ? (file as { edgeAnchorOverrides?: {} }).edgeAnchorOverrides ?? {} : {},
    collapsedClusters: new Set(collapsedArray),
  });
  useStyleStore.getState().hydrate({
    nodeStyles: file.styleOverrides ?? {},
    edgeStyles: isV11orHigher ? (file as { edgeStyles?: {} }).edgeStyles ?? {} : {},
    clusterStyles: isV12 ? (file as { clusterStyles?: {} }).clusterStyles ?? {} : {},
    annotations: file.annotations ?? [],
  });
  if (file.viewportState) {
    useUiStore.getState().setViewport(file.viewportState);
  }
}

export async function loadFromFile(file: File): Promise<ParseResult> {
  const text = await file.text();
  return loadFromText(text, file.name);
}
