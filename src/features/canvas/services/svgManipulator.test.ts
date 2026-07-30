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

  /**
   * Regression: the previous regex `^L-(.+)-(.+?)-\d+$` was greedy on the
   * source and non-greedy on the target, so `L-Start-Decision-0` would
   * split into source=`Start-Decisio`, target=`n`. When those don't match
   * any node, the edge router silently gave up and the line disconnected.
   */
  it('splits multi-character user node ids correctly (Start/Decision/Ship/Debug)', () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <g class="node" id="flowchart-Start-0" transform="translate(0,0)">
            <rect x="0" y="0" width="60" height="40" />
          </g>
          <g class="node" id="flowchart-Decision-1" transform="translate(80,0)">
            <rect x="0" y="0" width="60" height="40" />
          </g>
          <g class="node" id="flowchart-Ship-2" transform="translate(160,0)">
            <rect x="0" y="0" width="60" height="40" />
          </g>
          <g class="node" id="flowchart-Debug-3" transform="translate(240,0)">
            <rect x="0" y="0" width="60" height="40" />
          </g>
        </g>
        <g class="edgePaths">
          <path d="M 0 0" id="L-Start-Decision-0" />
          <path d="M 0 0" id="L-Decision-Ship-0" />
          <path d="M 0 0" id="L-Decision-Debug-0" />
        </g>
      </svg>`;
    const out = annotateInteractiveElements(svg);
    const edges = extractEdges(out);
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: 'Start', targetId: 'Decision' }),
        expect.objectContaining({ sourceId: 'Decision', targetId: 'Ship' }),
        expect.objectContaining({ sourceId: 'Decision', targetId: 'Debug' }),
      ]),
    );
  });

  /**
   * Regression: also handle node ids that themselves contain dashes.
   * The disambiguation walks every split position and picks the one
   * where both halves are known node ids.
   */
  it('handles node ids that contain dashes', () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <g class="node" id="flowchart-foo-bar-0" transform="translate(0,0)">
            <rect x="0" y="0" width="60" height="40" />
          </g>
          <g class="node" id="flowchart-baz-1" transform="translate(80,0)">
            <rect x="0" y="0" width="60" height="40" />
          </g>
        </g>
        <g class="edgePaths">
          <path d="M 0 0" id="L-foo-bar-baz-0" />
        </g>
      </svg>`;
    const out = annotateInteractiveElements(svg);
    const edges = extractEdges(out);
    expect(edges[0]).toMatchObject({ sourceId: 'foo-bar', targetId: 'baz' });
  });
});
