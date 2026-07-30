import { describe, it, expect } from 'vitest';
import { annotateInteractiveElements } from './svgManipulator';
import { routeAllEdges, expandViewBoxToFit, nodeRect, anchorOn, bezierPath } from './edgeRouter';

/**
 * These tests protect the three bug fixes:
 *   1. Dragged nodes must not vanish when they leave the initial viewBox.
 *   2. Edges must stay connected to node sides after nodes move.
 *   3. Adding/removing nodes (i.e. re-annotating a fresh SVG) must produce
 *      edges that already reference the correct source/target nodes.
 */
const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <g class="nodes">
    <g class="node default" id="flowchart-A-0" transform="translate(50, 40)">
      <rect x="-30" y="-15" width="60" height="30"></rect>
    </g>
    <g class="node default" id="flowchart-B-1" transform="translate(150, 40)">
      <rect x="-30" y="-15" width="60" height="30"></rect>
    </g>
  </g>
  <g class="edgePaths">
    <path class="edge" id="L-A-B-0" d="M 80 40 L 120 40"></path>
  </g>
</svg>`;

function loadSvg(source: string): SVGSVGElement {
  const annotated = annotateInteractiveElements(source);
  const doc = new DOMParser().parseFromString(annotated, 'image/svg+xml');
  document.body.innerHTML = '';
  document.body.appendChild(doc.documentElement);
  return document.body.querySelector('svg') as SVGSVGElement;
}

describe('edgeRouter', () => {
  it('anchorOn picks the near side of a rect facing a target', () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    const right = anchorOn(rect, { x: 500, y: 25 });
    expect(right.x).toBe(100);
    const above = anchorOn(rect, { x: 50, y: -500 });
    expect(above.y).toBe(0);
  });

  it('bezierPath is well-formed', () => {
    const p = bezierPath({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(p).toMatch(/^M 0 0 C /);
    expect(p).toContain(' 100 50');
  });

  it('nodeRect reflects the current translate', () => {
    const svg = loadSvg(SVG);
    const g = svg.querySelector<SVGGElement>('g[data-node-id="A"]')!;
    const r0 = nodeRect(g)!;
    expect(r0).toMatchObject({ x: 20, y: 25, width: 60, height: 30 });

    // Simulate a drag beyond the initial viewBox.
    g.setAttribute('transform', 'translate(500, 300)');
    const r1 = nodeRect(g)!;
    expect(r1).toMatchObject({ x: 470, y: 285 });
  });

  /**
   * Regression: Mermaid renders diamond / hexagon / trapezoid nodes as a
   * `<polygon>` whose `points` start at the local origin AND that carries
   * its own `translate()` to re-center the polygon within the group. If we
   * ignore that inner transform, `nodeRect` returns a bounding box shifted
   * away from where the polygon actually renders, and edges anchored to
   * that rect appear to float in mid-air.
   */
  it('nodeRect composes the shape child transform (diamond / polygon)', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <!-- Diamond: group at (305, 174), polygon translated by (-73, 73). -->
          <g class="node" id="flowchart-B-1" transform="translate(305, 174)">
            <polygon transform="translate(-73, 73)"
                     points="73,0 147,-73 73,-147 0,-73"/>
          </g>
        </g>
      </svg>`);
    const g = svg.querySelector<SVGGElement>('g[data-node-id="B"]')!;
    const r = nodeRect(g)!;
    // Composite rect origin: (305 + (-73) + 0, 174 + 73 + (-147)) = (232, 100).
    // Width/height = polygon bounds = (147, 147).
    expect(r).toMatchObject({ x: 232, y: 100, width: 147, height: 147 });
  });

  /**
   * End-to-end scenario matching the user's screenshot: `Start` (rect at
   * top) connected to a diamond `Decision` below. Even after dragging the
   * diamond, the edge endpoint must land inside/on the diamond's actual
   * bounding rect — not floating above it.
   */
  it('edge endpoint lands on the diamond after dragging it (regression: composed transforms)', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <g class="node" id="flowchart-A-0" transform="translate(500, 20)">
            <rect x="-25" y="-19" width="50" height="39"/>
          </g>
          <g class="node" id="flowchart-B-1" transform="translate(500, 200)">
            <polygon transform="translate(-73, 73)"
                     points="73,0 147,-73 73,-147 0,-73"/>
          </g>
        </g>
        <g class="edgePaths">
          <path class="edge" id="L-A-B-0" d="M 500 39 L 500 126"/>
        </g>
      </svg>`);

    // Drag B far to the left.
    svg.querySelector<SVGGElement>('g[data-node-id="B"]')!
      .setAttribute('transform', 'translate(300, 400)');
    routeAllEdges(svg);

    // B's composed rect = origin (300 + (-73), 400 + 73 + (-147)) = (227, 326),
    // size (147, 147). B_center ≈ (300.5, 399.5).
    // A_rect (x=-25 y=-19 w=50 h=39) offset by (500, 20) → (475, 1, 50, 39),
    // A_center = (500, 20). |dy|=379.5 > |dx|=199.5 → A anchors on its BOTTOM
    // side (x=500, y=1+39=40). B anchors on its TOP side (y=326, x=300.5).
    const d = svg.querySelector<SVGPathElement>('path[data-edge-id="L-A-B-0"]')!.getAttribute('d')!;
    expect(d).toMatch(/^M 500 40 /);

    // The critical invariant: the end point must be inside B's composed rect.
    const match = / (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/.exec(d)!;
    const endX = Number(match[1]);
    const endY = Number(match[2]);
    expect(endX).toBeGreaterThanOrEqual(227);
    expect(endX).toBeLessThanOrEqual(374);
    expect(endY).toBeGreaterThanOrEqual(326);
    expect(endY).toBeLessThanOrEqual(473);
  });

  it('routeAllEdges reconnects paths to node sides after a node moves', () => {
    const svg = loadSvg(SVG);
    const b = svg.querySelector<SVGGElement>('g[data-node-id="B"]')!;

    // Move B far to the right and down.
    b.setAttribute('transform', 'translate(600, 400)');
    routeAllEdges(svg);

    const path = svg.querySelector<SVGPathElement>('path[data-edge-id="L-A-B-0"]')!;
    const d = path.getAttribute('d')!;
    // Should start at A's right anchor (x=80) and end at B's left anchor
    // (x = 570 = 600 - 30) at y=400.
    expect(d).toMatch(/^M 80 40 C /);
    expect(d).toMatch(/ 570 400$/);
  });

  it('routeAllEdges also reroutes when the OTHER end moves', () => {
    // Regression for bug 3: adjacent (non-dragged) edges detaching when
    // their sibling node moves.
    const svg = loadSvg(SVG);
    const a = svg.querySelector<SVGGElement>('g[data-node-id="A"]')!;
    a.setAttribute('transform', 'translate(-100, -100)');
    routeAllEdges(svg);

    const path = svg.querySelector<SVGPathElement>('path[data-edge-id="L-A-B-0"]')!;
    const d = path.getAttribute('d')!;
    // A's right side is at x = -100 + 30 = -70.
    expect(d).toMatch(/^M -70 -100 C /);
    // B still at 150,40 so its left anchor is at x = 120, y = 40.
    expect(d).toMatch(/ 120 40$/);
  });

  it('expandViewBoxToFit grows the viewBox to include off-canvas nodes', () => {
    const svg = loadSvg(SVG);
    const b = svg.querySelector<SVGGElement>('g[data-node-id="B"]')!;
    b.setAttribute('transform', 'translate(1000, 800)');

    expandViewBoxToFit(svg, 20);
    const vb = svg.getAttribute('viewBox')!.split(/\s+/).map(Number);
    // maxX >= 1000 + 30 (rect half-width) + 20 padding.
    expect(vb[0] + vb[2]).toBeGreaterThanOrEqual(1050);
    expect(vb[1] + vb[3]).toBeGreaterThanOrEqual(830);
  });

  it('annotate adds data-edge-source/target from the edge id', () => {
    const out = annotateInteractiveElements(SVG);
    expect(out).toContain('data-edge-source="A"');
    expect(out).toContain('data-edge-target="B"');
  });

  /**
   * Regression for the exact scenario in the screenshots: dragging
   * Start / Decision / Debug leaves their arrows stranded because either
   * (a) endpoints weren't disambiguated from the edge id, or (b) even if
   * they were, routing wasn't re-run. This test simulates the user drags
   * and asserts every edge's `d` attribute has been re-issued to touch
   * the correct endpoints.
   */
  it('routes a real flowchart correctly after multi-node drag', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
        <g class="nodes">
          <g class="node" id="flowchart-Start-0" transform="translate(200, 40)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
          <g class="node" id="flowchart-Decision-1" transform="translate(200, 120)">
            <rect x="-40" y="-20" width="80" height="40"/>
          </g>
          <g class="node" id="flowchart-Ship-2" transform="translate(120, 220)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
          <g class="node" id="flowchart-Debug-3" transform="translate(280, 220)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
        </g>
        <g class="edgePaths">
          <path class="edge" id="L-Start-Decision-0" d="M 200 55 L 200 100"/>
          <path class="edge" id="L-Decision-Ship-0" d="M 200 140 L 120 205"/>
          <path class="edge" id="L-Decision-Debug-0" d="M 200 140 L 280 205"/>
        </g>
      </svg>`);

    // Drag every non-leaf node far from its original position.
    svg.querySelector<SVGGElement>('g[data-node-id="Start"]')!.setAttribute('transform', 'translate(500, 30)');
    svg.querySelector<SVGGElement>('g[data-node-id="Decision"]')!.setAttribute('transform', 'translate(200, 240)');
    svg.querySelector<SVGGElement>('g[data-node-id="Debug"]')!.setAttribute('transform', 'translate(700, 500)');

    routeAllEdges(svg);

    // Every edge must have its `d` regenerated with anchors on both nodes.
    const paths = Array.from(svg.querySelectorAll<SVGPathElement>('path[data-edge-id]'));
    paths.forEach((p) => {
      const d = p.getAttribute('d')!;
      // Must be a bezier we produced (starts with M, contains C).
      expect(d).toMatch(/^M -?\d/);
      expect(d).toContain(' C ');
    });

    // Start→Decision should now anchor on the left/right side of Start
    // (Start is far right, Decision is bottom-center). Anchor on right of
    // Decision (x = 240) and left of Start (x = 500 - 30 = 470).
    const startDecision = svg.querySelector<SVGPathElement>(
      'path[data-edge-source="Start"][data-edge-target="Decision"]',
    )!;
    const d1 = startDecision.getAttribute('d')!;
    // Start rect: x=470..530, Decision rect: x=160..240 → anchor Start.left (470) and Decision.right (240).
    expect(d1).toMatch(/^M 470 30 /);
    expect(d1).toMatch(/ 240 240$/);
  });

  /**
   * Fallback: when annotation cannot parse the edge id (unknown format),
   * the geometry-based fallback in routeAllEdges connects the edge to the
   * two nearest nodes based on the path's original endpoints, and caches
   * that inference so subsequent frames are O(1).
   *
   * Because annotateInteractiveElements already runs an initial routing
   * pass, the caching happens up-front — this test verifies both.
   */
  it('falls back to geometry when data-edge-source/target cannot be parsed', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <g class="node" id="flowchart-A-0" transform="translate(50, 40)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
          <g class="node" id="flowchart-B-1" transform="translate(150, 40)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
        </g>
        <g class="edgePaths">
          <!-- id that the annotator can't split into source/target -->
          <path class="edge" id="edge_weird_format" d="M 50 40 L 150 40"/>
        </g>
      </svg>`);
    // The initial routing pass inside annotate should have inferred + cached.
    const p = svg.querySelector<SVGPathElement>('path[data-edge-id]')!;
    expect(p.getAttribute('data-edge-source')).toBe('A');
    expect(p.getAttribute('data-edge-target')).toBe('B');
    // And the path should be a bezier from A's right to B's left.
    const d = p.getAttribute('d')!;
    expect(d).toMatch(/^M 80 40 /);
    expect(d).toMatch(/ 120 40$/);
  });

  /**
   * Regression: `D --> D` (self-loop). Before the fix, `routeAllEdges`
   * short-circuited on `srcRect === tgtRect`, leaving Mermaid's originally
   * emitted loop path in place — which meant the loop stayed at the node's
   * ORIGINAL location and detached as soon as the user dragged D.
   */
  it('draws a self-loop path anchored to the node (regression: D → D)', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <g class="node" id="flowchart-D-0" transform="translate(400, 300)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
        </g>
        <g class="edgePaths">
          <path class="edge" id="L-D-D-0" d="M 100 100 L 110 100"/>
        </g>
      </svg>`);

    // Move D and reroute.
    svg.querySelector<SVGGElement>('g[data-node-id="D"]')!
      .setAttribute('transform', 'translate(600, 250)');
    routeAllEdges(svg);

    const d = svg.querySelector<SVGPathElement>('path[data-edge-id="L-D-D-0"]')!.getAttribute('d')!;
    // Rect after move: x=570..630, y=235..265, cy=250. Loop starts on the
    // right side (x=630).
    expect(d).toMatch(/^M 630 /);
    // The loop must curve OUTSIDE the rect (control points x > 630).
    const nums = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    // At least one control-point x-coord must be > right edge.
    const xs = nums.filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeGreaterThan(630);
  });

  /**
   * Regression: edge labels ("Yes" / "No") stayed at Mermaid's initial
   * layout coordinates because svgManipulator was looking for `id`
   * attributes on `g.edgeLabel` that Mermaid doesn't emit. This test uses
   * positional matching (label i ↔ edge path i) and verifies that after
   * `routeAllEdges` the label transform sits near the new midpoint.
   */
  it('moves edge labels to the midpoint of the rerouted path', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <g class="node" id="flowchart-A-0" transform="translate(50, 40)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
          <g class="node" id="flowchart-B-1" transform="translate(250, 40)">
            <rect x="-30" y="-15" width="60" height="30"/>
          </g>
        </g>
        <g class="edgePaths">
          <path class="edge" id="L-A-B-0" d="M 80 40 L 220 40"/>
        </g>
        <g class="edgeLabels">
          <g class="edgeLabel" transform="translate(999, 999)">
            <span class="edgeLabel">Yes</span>
          </g>
        </g>
      </svg>`);

    // Annotation should have positionally linked the label to L-A-B-0.
    const label = svg.querySelector<SVGGElement>('g.edgeLabel[data-edge-id="L-A-B-0"]')!;
    expect(label).not.toBeNull();

    // Move B so the edge midpoint moves too.
    svg.querySelector<SVGGElement>('g[data-node-id="B"]')!
      .setAttribute('transform', 'translate(500, 100)');
    routeAllEdges(svg);

    // Label transform should have been updated to something close to the
    // midpoint of the new bezier (roughly between (80,40) and (470,100)).
    const t = label.getAttribute('transform')!;
    // Not the sentinel 999,999 anymore.
    expect(t).not.toContain('999');
    const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(t)!;
    const lx = Number(m[1]);
    const ly = Number(m[2]);
    // Midpoint of endpoints (80,40)→(470,100) = (275,70). Bezier midpoint
    // may drift a bit, so accept a reasonable band.
    expect(lx).toBeGreaterThan(150);
    expect(lx).toBeLessThan(400);
    expect(ly).toBeGreaterThan(30);
    expect(ly).toBeLessThan(110);
  });
});
