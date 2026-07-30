import { describe, it, expect } from 'vitest';
import {
  annotateInteractiveElements,
  extractNodes,
  extractEdges,
} from './svgManipulator';

const SAMPLE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
  <g class="nodes">
    <g class="node" id="flowchart-A-0" transform="translate(10, 20)">
      <rect x="0" y="0" width="60" height="40" />
      <text class="nodeLabel">Start</text>
    </g>
    <g class="node" id="flowchart-B-1" transform="translate(120, 20)">
      <rect x="0" y="0" width="60" height="40" />
      <text class="nodeLabel">End</text>
    </g>
  </g>
  <g class="edgePaths">
    <path d="M 70 40 L 120 40" id="L-A-B-0" />
  </g>
</svg>
`;

describe('svgManipulator', () => {
  it('annotates nodes with data-node-id', () => {
    const out = annotateInteractiveElements(SAMPLE_SVG);
    expect(out).toContain('data-node-id="A"');
    expect(out).toContain('data-node-id="B"');
    expect(out).toContain('mf-node--draggable');
  });

  it('extracts node bounding boxes', () => {
    const out = annotateInteractiveElements(SAMPLE_SVG);
    const nodes = extractNodes(out);
    expect(nodes).toHaveLength(2);
    const a = nodes.find((n) => n.id === 'A')!;
    expect(a.bbox).toMatchObject({ x: 10, y: 20, width: 60, height: 40 });
    expect(a.label).toBe('Start');
  });

  it('extracts edges with inferred endpoints', () => {
    const out = annotateInteractiveElements(SAMPLE_SVG);
    const edges = extractEdges(out);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ sourceId: 'A', targetId: 'B' });
  });
});
