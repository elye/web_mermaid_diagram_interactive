/**
 * svgManipulator — post-processes a Mermaid-produced SVG string:
 *
 *  - Adds `data-node-id` / `data-edge-id` / `data-edge-source` / `data-edge-target`
 *    attributes on interactive elements, derived from Mermaid's internal id
 *    conventions.
 *  - Runs an initial routing pass so edges are anchor-aware from the very
 *    first render (no visible "jump" on first drag).
 *  - Extracts node bounding boxes for use by the drag/edge-routing systems.
 *
 * These functions are pure and DOM-parser based, so they are safe to test
 * headlessly (jsdom).
 */
import type { NodeMeta, EdgeMeta, BBox } from '@/shared/types/diagram';
import { routeAllEdges, expandViewBoxToFit } from './edgeRouter';

const NODE_CLASS_RE = /(?:^|\s)node(?:\s|$)/;

function parseSvg(svgString: string): Document {
  return new DOMParser().parseFromString(svgString, 'image/svg+xml');
}

function serialize(doc: Document): string {
  return new XMLSerializer().serializeToString(doc.documentElement);
}

/**
 * Extract the user-defined node ID from Mermaid's mangled DOM id.
 * Mermaid emits ids like "flowchart-A-0", "flowchart-A0-1", "flowchart-A-2-4".
 * The user id sits between the diagram-type prefix and a trailing numeric
 * counter. Some diagrams (state, class) prefix differently.
 */
function extractUserNodeId(rawId: string): string {
  // Strip a known prefix.
  const withoutPrefix = rawId.replace(
    /^(?:flowchart|node|state|classGroup|class|er|sequence)-/,
    '',
  );
  // Strip trailing "-<digits>" counters (Mermaid appends a render counter).
  return withoutPrefix.replace(/-\d+$/, '');
}

/**
 * Extract source/target user node IDs from a Mermaid edge id.
 * Mermaid encodes edges as: `L-<source>-<target>-<n>` (dash form, current),
 * or `L_<source>_<target>_<n>` (underscore form, older).
 *
 * The counter (`-<n>` or `_<n>`) is always a trailing integer.
 *
 * Splitting `<source>` from `<target>` is ambiguous when either contains the
 * same separator character (e.g. a node named `foo-bar`). We resolve this
 * by walking every possible split position and picking the one where BOTH
 * halves match a known user node id (`knownIds`). If we cannot disambiguate,
 * we return null rather than guess — the router will simply skip that edge
 * (leaving Mermaid's original path in place).
 */
function extractEdgeEndpoints(
  edgeId: string,
  knownIds: ReadonlySet<string>,
): { source: string; target: string } | null {
  // 1. Detect separator + strip prefix + trailing counter.
  let inner: string;
  let sep: '-' | '_';
  const dashM = /^L-(.+)-\d+$/.exec(edgeId);
  const underM = /^L_(.+)_\d+$/.exec(edgeId);
  if (dashM) {
    inner = dashM[1];
    sep = '-';
  } else if (underM) {
    inner = underM[1];
    sep = '_';
  } else {
    return null;
  }

  // 2. Fast path — the common case: node ids contain no separator character.
  //    Try each split and prefer one whose both halves are known ids.
  const parts = inner.split(sep);
  // Walk from smallest source to largest — we prefer the FIRST valid split.
  for (let i = 1; i < parts.length; i += 1) {
    const source = parts.slice(0, i).join(sep);
    const target = parts.slice(i).join(sep);
    if (knownIds.has(source) && knownIds.has(target)) {
      return { source, target };
    }
  }

  // 3. Fallback — the parser has ambiguous ids OR we haven't collected the
  //    node id set yet (e.g. an edge with no matching node in the DOM).
  //    In that case, guess "source has no separator" — the simplest common case.
  if (parts.length >= 2) {
    return { source: parts[0], target: parts.slice(1).join(sep) };
  }
  return null;
}

/**
 * Add machine-readable interaction attributes to the SVG and perform an
 * initial edge-routing pass so anchors start out aligned to node sides.
 */
export function annotateInteractiveElements(svgString: string): string {
  const doc = parseSvg(svgString);
  const svg = doc.documentElement as unknown as SVGSVGElement;
  if (svg.nodeName.toLowerCase() !== 'svg') return svgString;

  // Ensure the SVG never clips content that has been moved outside its box.
  (svg as unknown as HTMLElement).style.overflow = 'visible';

  // --- Nodes ---
  // Mermaid emits <g class="node" id="flowchart-A-0"> — but the class list
  // varies by diagram type, so we also accept anything with `class~="node"`.
  const nodeGroups = svg.querySelectorAll('g.node, g[class~="node"]');
  const seenIds = new Set<string>();
  const nodeIdSet = new Set<string>();
  nodeGroups.forEach((g) => {
    if (!NODE_CLASS_RE.test(g.getAttribute('class') ?? '')) return;
    const rawId = g.getAttribute('id') ?? '';
    let userId = extractUserNodeId(rawId);
    // Disambiguate duplicates that can occur when Mermaid renders subgraphs.
    if (seenIds.has(userId)) userId = `${userId}__${seenIds.size}`;
    seenIds.add(userId);
    nodeIdSet.add(userId);
    g.setAttribute('data-node-id', userId);
    g.classList.add('mf-node--draggable');
  });

  // --- Edges ---
  // Selector covers current Mermaid (`g.edgePaths > path.flowchart-link`),
  // older releases, and defensively anything with an `edge` class.
  const edgeGroups = svg.querySelectorAll(
    'g.edgePaths > path, path.flowchart-link, path[class*="edge"]',
  );
  let counter = 0;
  edgeGroups.forEach((p) => {
    counter += 1;
    const rawId = p.getAttribute('id') ?? `edge-${counter}`;
    p.setAttribute('data-edge-id', rawId);
    // Disambiguate source/target using the known node-id set so ids like
    // `L-Start-Decision-0` don't get chopped to `Start-Decisio` + `n`.
    const endpoints = extractEdgeEndpoints(rawId, nodeIdSet);
    if (endpoints) {
      p.setAttribute('data-edge-source', endpoints.source);
      p.setAttribute('data-edge-target', endpoints.target);
    }
  });

  // Tag edge labels with their edge id too, so the router can move them
  // alongside the path.
  const edgeLabels = svg.querySelectorAll('g.edgeLabel[id], .edgeLabel[id]');
  edgeLabels.forEach((label) => {
    const rawId = label.getAttribute('id') ?? '';
    // Mermaid edge labels are usually "L-A-B-0" too, but sometimes wrapped.
    if (rawId) label.setAttribute('data-edge-id', rawId);
  });

  // Initial routing pass so anchors are already aligned when the SVG appears.
  try {
    routeAllEdges(svg);
    expandViewBoxToFit(svg);
  } catch {
    /* jsdom or malformed svg — safe to ignore, DiagramCanvas will retry. */
  }

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
    edges.push({
      id,
      sourceId: p.getAttribute('data-edge-source'),
      targetId: p.getAttribute('data-edge-target'),
    });
  });
  return edges;
}

/**
 * Read a group's bounding box in the SVG root's coordinate space. Composes
 * the group's `transform="translate(x,y)"` with the shape child's own
 * transform (Mermaid uses one on polygons/etc. to center them).
 */
function readGroupBBox(g: Element): BBox | null {
  const t = parseTranslateAttr(g.getAttribute('transform'));
  const shape = g.querySelector('rect, polygon, circle, ellipse, path');
  if (!shape) return null;
  const s = parseTranslateAttr(shape.getAttribute('transform'));
  const ox = t.x + s.x;
  const oy = t.y + s.y;

  if (shape.tagName === 'rect') {
    const x = Number(shape.getAttribute('x') ?? '0');
    const y = Number(shape.getAttribute('y') ?? '0');
    const width = Number(shape.getAttribute('width') ?? '0');
    const height = Number(shape.getAttribute('height') ?? '0');
    return { x: ox + x, y: oy + y, width, height };
  }
  if (shape.tagName === 'circle') {
    const cx = Number(shape.getAttribute('cx') ?? '0');
    const cy = Number(shape.getAttribute('cy') ?? '0');
    const r = Number(shape.getAttribute('r') ?? '0');
    return { x: ox + cx - r, y: oy + cy - r, width: r * 2, height: r * 2 };
  }
  if (shape.tagName === 'ellipse') {
    const cx = Number(shape.getAttribute('cx') ?? '0');
    const cy = Number(shape.getAttribute('cy') ?? '0');
    const rx = Number(shape.getAttribute('rx') ?? '0');
    const ry = Number(shape.getAttribute('ry') ?? '0');
    return { x: ox + cx - rx, y: oy + cy - ry, width: rx * 2, height: ry * 2 };
  }
  if (shape.tagName === 'polygon') {
    const pts = (shape.getAttribute('points') ?? '')
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isFinite);
    if (pts.length >= 4) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]);
        maxX = Math.max(maxX, pts[i]);
        minY = Math.min(minY, pts[i + 1]);
        maxY = Math.max(maxY, pts[i + 1]);
      }
      return { x: ox + minX, y: oy + minY, width: maxX - minX, height: maxY - minY };
    }
  }
  // path or unrecognised shape — best-effort empty box at the origin.
  return { x: ox, y: oy, width: 0, height: 0 };
}

function parseTranslateAttr(transform: string | null): { x: number; y: number } {
  if (!transform) return { x: 0, y: 0 };
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}
