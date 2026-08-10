/**
 * renderEngine — thin wrapper over mermaid.render().
 *
 * Mermaid is dynamically imported to keep the initial bundle small and to allow
 * a future move into a Web Worker without touching call sites.
 */
import type { NodeMeta, EdgeMeta } from '@/shared/types/diagram';
import { extractNodes, extractEdges, annotateInteractiveElements } from './svgManipulator';

let mermaidInitialised = false;
let renderId = 0;

async function loadMermaid() {
  const mod = await import('mermaid');
  const mermaid = mod.default;
  if (!mermaidInitialised) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
      flowchart: { htmlLabels: true },
      maxTextSize: 1000000,
      maxEdges: 20000,
    });
    mermaidInitialised = true;
  }
  return mermaid;
}

export interface RenderResult {
  svg: string;
  nodes: NodeMeta[];
  edges: EdgeMeta[];
}

/**
 * Render Mermaid source to an interactive-annotated SVG string.
 * Throws with a human-readable message on parse errors.
 */
export async function renderMermaid(source: string): Promise<RenderResult> {
  if (!source.trim()) {
    return { svg: '', nodes: [], edges: [] };
  }
  const mermaid = await loadMermaid();
  renderId += 1;
  const id = `mf-render-${renderId}`;
  const { svg } = await mermaid.render(id, source);
  const annotated = annotateInteractiveElements(svg);
  const nodes = extractNodes(annotated);
  const edges = extractEdges(annotated);
  return { svg: annotated, nodes, edges };
}
