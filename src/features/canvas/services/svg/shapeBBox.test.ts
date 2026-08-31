import { describe, it, expect } from 'vitest';
import { groupBBox } from './shapeBBox';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Build a Mermaid-like node `<g>`: shape first, then a `<g class="label">`
 *  containing its own (near-zero) `<rect>` — the exact structure that
 *  triggered the "picks the label's rect instead of the shape" bug. */
function buildNodeGroup(shape: SVGElement, transform = 'translate(100, 50)'): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('transform', transform);
  g.appendChild(shape);
  const label = document.createElementNS(SVG_NS, 'g');
  label.setAttribute('class', 'label');
  const labelRect = document.createElementNS(SVG_NS, 'rect');
  // Mermaid's label background rect has no width/height/x/y attributes.
  label.appendChild(labelRect);
  g.appendChild(label);
  return g;
}

describe('groupBBox', () => {
  it('measures a rect-shaped node', () => {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'basic label-container');
    rect.setAttribute('x', '-40');
    rect.setAttribute('y', '-20');
    rect.setAttribute('width', '80');
    rect.setAttribute('height', '40');
    const g = buildNodeGroup(rect);
    expect(groupBBox(g)).toEqual({ x: 60, y: 30, width: 80, height: 40 });
  });

  it('measures a cylinder-shaped node (bare <path>, no points attribute)', () => {
    // Real Mermaid cylinder path: two half-ellipse arcs + verticals, no class.
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute(
      'd',
      'M 0,9.79 a 40.25,9.79 0,0,0 80.49 0 a 40.25,9.79 0,0,0 -80.49 0 l 0,48.79 a 40.25,9.79 0,0,0 80.49 0 l 0,-48.79',
    );
    path.setAttribute('transform', 'translate(-40.25,-34.19)');
    const g = buildNodeGroup(path);
    const bbox = groupBBox(g);
    expect(bbox).not.toBeNull();
    // Must reflect the cylinder's real footprint, not the label rect's 0x0.
    expect(bbox!.width).toBeGreaterThan(70);
    expect(bbox!.height).toBeGreaterThan(60);
  });

  it('does not pick the label rect as the shape for a path-shaped node', () => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M 0,0 L 50,0 L 50,30 L 0,30 Z');
    const g = buildNodeGroup(path);
    const bbox = groupBBox(g);
    expect(bbox).not.toBeNull();
    expect(bbox!.width).toBeGreaterThan(0);
    expect(bbox!.height).toBeGreaterThan(0);
  });

  it('measures a polygon-shaped node (diamond) via its own translate', () => {
    const polygon = document.createElementNS(SVG_NS, 'polygon');
    polygon.setAttribute('points', '0,-20 40,0 0,20 -40,0');
    polygon.setAttribute('transform', 'translate(5, 5)');
    const g = buildNodeGroup(polygon);
    expect(groupBBox(g)).toEqual({ x: 65, y: 35, width: 80, height: 40 });
  });
});
