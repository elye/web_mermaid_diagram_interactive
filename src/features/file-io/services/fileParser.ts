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
      const supported = parsed.version === '1.0' || parsed.version === '1.1';
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
  // v1.0 files simply omit them → treated as empty maps.
  const isV11 = file.version === '1.1';
  useDiagramStore.getState().hydrate({
    source: file.mermaidSource,
    positionOverrides: file.positionOverrides ?? {},
    edgeWaypoints: isV11 ? file.edgeWaypoints ?? {} : {},
    edgeAnchorOverrides: isV11 ? file.edgeAnchorOverrides ?? {} : {},
  });
  useStyleStore.getState().hydrate({
    nodeStyles: file.styleOverrides ?? {},
    edgeStyles: isV11 ? file.edgeStyles ?? {} : {},
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
