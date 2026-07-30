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
      if (parsed.version !== '1.0' || typeof parsed.mermaidSource !== 'string') {
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
  useDiagramStore.getState().hydrate({
    source: file.mermaidSource,
    positionOverrides: file.positionOverrides ?? {},
  });
  useStyleStore.getState().hydrate({
    nodeStyles: file.styleOverrides ?? {},
    edgeStyles: {},
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
