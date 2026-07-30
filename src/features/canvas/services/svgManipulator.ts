/**
 * svgManipulator — post-processes a Mermaid-produced SVG string:
 *
 *  - Adds `data-node-id` / `data-edge-id` attributes on interactive elements,
 *    derived from Mermaid's internal id conventions.
 *  - Extracts node bounding boxes for use by the drag/edge-routing systems.
 *
 * These functions are pure and DOM-parser based, so they are safe to test
 * headlessly (jsdom).
 */
import type { NodeMeta, EdgeMeta, BBox } from '@/shared/types/diagram';

const NODE_CLASS_RE = /(?:^|\s)node(?:\s|$)/;

function parseSvg(svgString: string): Document {
  return new DOMParser().parseFromString(svgString, 'image/svg+xml');
}

function serialize(doc: Document): string {
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/**
 * Extract the user-defined node ID from Mermaid's mangled DOM id.
 * Mermaid emits ids like "flowchart-A-0" or "flowchart-A0-1"; we take the
 * middle segment (before the trailing numeric counter).
 */
function extractUserNodeId(rawId: string): string {
  // Common patterns:
  //   flowchart-A-1        -> A
  //   node-A               -> A
  //   L-A-B                -> edge from A to B
  const m = /^(?:flowchart|node|state|class)-([^-]+)(?:-\d+)?$/.exec(rawId);
  if (m) return m[1];
  return rawId;
}

/**
 * Add machine-readable interaction attributes to the SVG.
 */
export function annotateInteractiveElements(svgString: string): string {
  const doc = parseSvg(svgString);
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') return svgString;

  // Nodes: Mermaid emits <g class="node" id="flowchart-A-0">
  const nodeGroups = svg.querySelectorAll('g.node, g[class*="node "]');
  nodeGroups.forEach((g) => {
    if (!NODE_CLASS_RE.test(g.getAttribute('class') ?? '')) return;
    const rawId = g.getAttribute('id') ?? '';
    const userId = extractUserNodeId(rawId);
    g.setAttribute('data-node-id', userId);
    g.classList.add('mf-node--draggable');
  });

  // Edges/paths: Mermaid emits <path class="edgePath"> and <g class="edgeLabel">
  const edgeGroups = svg.querySelectorAll('g.edgePaths path, path.flowchart-link');
  let counter = 0;
  edgeGroups.forEach((p) => {
    counter += 1;
    const existing = p.getAttribute('id') ?? `edge-${counter}`;
    p.setAttribute('data-edge-id', existing);
  });

  return serialize(doc);
}

/**
 * Extract node bounding boxes for use in position resolution.
 */
export function extractNodes(svgString: string): NodeMeta[] {
  const doc = parseSvg(svgString);
  const groups = doc.querySelectorAll('g[data-node-id]');
  const nodes: NodeMeta[] = [];

  groups.forEach((g) => {
    const id = g.getAttribute('data-node-id')!;
    const bbox = readGroupBBox(g);
    if (!bbox) return;
    const label = (g.querySelector('.nodeLabel, foreignObject, text')?.textContent ?? id).trim();
    nodes.push({ id, label, bbox });
  });

  return nodes;
}

/**
 * Extract edges as simple metadata; source/target inference from Mermaid's
 * id conventions when available.
 */
export function extractEdges(svgString: string): EdgeMeta[] {
  const doc = parseSvg(svgString);
  const paths = doc.querySelectorAll('path[data-edge-id]');
  const edges: EdgeMeta[] = [];
  paths.forEach((p) => {
    const id = p.getAttribute('data-edge-id')!;
    // Mermaid convention: id="L-A-B-0" for edge A->B
    const m = /^L-([^-]+)-([^-]+)/.exec(id);
    edges.push({ id, sourceId: m?.[1] ?? null, targetId: m?.[2] ?? null });
  });
  return edges;
}

/**
 * Read a group's local bounding box from its `transform="translate(x,y)"`
 * plus the child rect/polygon/circle metrics. Falls back to (0,0,w,h).
 */
function readGroupBBox(g: Element): BBox | null {
  const transform = g.getAttribute('transform') ?? '';
  const t = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
  const tx = t ? Number(t[1]) : 0;
  const ty = t ? Number(t[2]) : 0;

  const shape = g.querySelector('rect, polygon, circle, ellipse, path');
  if (!shape) return null;

  if (shape.tagName === 'rect') {
    const x = Number(shape.getAttribute('x') ?? '0');
    const y = Number(shape.getAttribute('y') ?? '0');
    const width = Number(shape.getAttribute('width') ?? '0');
    const height = Number(shape.getAttribute('height') ?? '0');
    return { x: tx + x, y: ty + y, width, height };
  }
  if (shape.tagName === 'circle') {
    const cx = Number(shape.getAttribute('cx') ?? '0');
    const cy = Number(shape.getAttribute('cy') ?? '0');
    const r = Number(shape.getAttribute('r') ?? '0');
    return { x: tx + cx - r, y: ty + cy - r, width: r * 2, height: r * 2 };
  }
  if (shape.tagName === 'ellipse') {
    const cx = Number(shape.getAttribute('cx') ?? '0');
    const cy = Number(shape.getAttribute('cy') ?? '0');
    const rx = Number(shape.getAttribute('rx') ?? '0');
    const ry = Number(shape.getAttribute('ry') ?? '0');
    return { x: tx + cx - rx, y: ty + cy - ry, width: rx * 2, height: ry * 2 };
  }
  // polygon / path: rough bbox from viewBox attr on parent — fallback zero size.
  return { x: tx, y: ty, width: 0, height: 0 };
}
