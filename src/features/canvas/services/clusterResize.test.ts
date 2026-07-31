import { describe, it, expect } from 'vitest';
import { parseSubgraphMembership, resizeClusters } from './clusterResize';

function loadSvg(source: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  document.body.innerHTML = '';
  document.body.appendChild(doc.documentElement);
  return document.body.querySelector('svg') as SVGSVGElement;
}

/** Current bbox of a cluster `<g>`, derived from its transform + inner rect. */
function clusterBBox(svg: SVGSVGElement, id: string) {
  const g = svg.querySelector<SVGGElement>(`g.cluster[id*="${id}"]`)!;
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(
    g.getAttribute('transform') ?? '',
  )!;
  const cx = Number(m[1]);
  const cy = Number(m[2]);
  const rect = g.querySelector('rect')!;
  const w = Number(rect.getAttribute('width'));
  const h = Number(rect.getAttribute('height'));
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
}

describe('parseSubgraphMembership', () => {
  it('returns empty map for diagrams without subgraphs', () => {
    const src = 'flowchart LR\n  A --> B --> C';
    expect(parseSubgraphMembership(src).size).toBe(0);
  });

  it('parses a single subgraph', () => {
    const src = `
flowchart LR
  subgraph sub1[My Sub]
    A --> B
  end
  C --> A
`;
    const m = parseSubgraphMembership(src);
    expect(m.has('sub1')).toBe(true);
    expect(m.get('sub1')!.has('A')).toBe(true);
    expect(m.get('sub1')!.has('B')).toBe(true);
    // C is outside the subgraph
    expect(m.get('sub1')!.has('C')).toBe(false);
  });

  it('parses nested subgraphs and records child sub as member of parent', () => {
    const src = `
flowchart TD
  subgraph outer
    subgraph inner
      X --> Y
    end
    Z --> X
  end
`;
    const m = parseSubgraphMembership(src);
    expect(m.has('outer')).toBe(true);
    expect(m.has('inner')).toBe(true);
    // inner is a member of outer
    expect(m.get('outer')!.has('inner')).toBe(true);
    // X, Y are members of inner
    expect(m.get('inner')!.has('X')).toBe(true);
    expect(m.get('inner')!.has('Y')).toBe(true);
    // Z is a member of outer (not inner)
    expect(m.get('outer')!.has('Z')).toBe(true);
    expect(m.get('inner')!.has('Z')).toBe(false);
  });

  it('parses deeply nested subgraphs (3 levels)', () => {
    const src = `
flowchart TD
  subgraph top
    subgraph mid
      subgraph leaf
        A --> B
      end
      C --> A
    end
    D --> C
  end
`;
    const m = parseSubgraphMembership(src);
    expect(m.get('leaf')!.has('A')).toBe(true);
    expect(m.get('leaf')!.has('B')).toBe(true);
    expect(m.get('mid')!.has('leaf')).toBe(true);
    expect(m.get('mid')!.has('C')).toBe(true);
    expect(m.get('top')!.has('mid')).toBe(true);
    expect(m.get('top')!.has('D')).toBe(true);
  });

  it('handles multiple sibling subgraphs', () => {
    const src = `
flowchart LR
  subgraph s1
    A --> B
  end
  subgraph s2
    C --> D
  end
  B --> C
`;
    const m = parseSubgraphMembership(src);
    expect(m.get('s1')!.has('A')).toBe(true);
    expect(m.get('s2')!.has('C')).toBe(true);
    // s1 and s2 are not members of each other
    expect(m.get('s1')!.has('s2')).toBe(false);
  });
});

describe('resizeClusters', () => {
  it('is a no-op when the SVG has no cluster elements', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <g data-node-id="A" transform="translate(10, 10)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
        </g>
      </svg>`);
    // Should not throw even though there's nothing to resize.
    expect(() => resizeClusters(svg, 'flowchart LR\n  subgraph s1\n A\n end')).not.toThrow();
  });

  it('is a no-op when the source has no subgraphs', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="clusters">
          <g class="cluster" id="flowchart-sub1-3" transform="translate(0, 0)">
            <rect x="-40" y="-40" width="80" height="80"></rect>
          </g>
        </g>
        <g class="nodes">
          <g data-node-id="A" transform="translate(10, 10)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
        </g>
      </svg>`);
    resizeClusters(svg, 'flowchart LR\n  A --> B');
    const rect = svg.querySelector('rect')!;
    expect(rect.getAttribute('width')).toBe('80');
    expect(rect.getAttribute('height')).toBe('80');
  });

  it('resizes a single cluster to tightly wrap its member nodes', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="clusters">
          <g class="cluster" id="flowchart-sub1-3" transform="translate(50, 50)">
            <rect x="-40" y="-40" width="80" height="80"></rect>
            <g class="label"><text>Sub1</text></g>
          </g>
        </g>
        <g class="nodes">
          <g data-node-id="A" transform="translate(10, 10)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
          <g data-node-id="B" transform="translate(90, 10)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
        </g>
      </svg>`);
    const src = `
flowchart LR
  subgraph sub1
    A --> B
  end
`;
    resizeClusters(svg, src);

    // A spans x:[0,20] y:[0,20]; B spans x:[80,100] y:[0,20].
    // Union: x:[0,100] y:[0,20], padded by 24/36/16.
    const box = clusterBBox(svg, 'sub1');
    expect(box.left).toBeCloseTo(-24);
    expect(box.top).toBeCloseTo(-36);
    expect(box.right).toBeCloseTo(124);
    expect(box.bottom).toBeCloseTo(36);

    // Label re-centred at the top of the new box.
    const label = svg.querySelector('g.label')!;
    expect(label.getAttribute('transform')).toBe('translate(0, -22)');
  });

  it('recognizes cluster ids with a `graph-` prefix', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="clusters">
          <g class="cluster" id="graph-sub1-1" transform="translate(0, 0)">
            <rect x="-40" y="-40" width="80" height="80"></rect>
          </g>
        </g>
        <g class="nodes">
          <g data-node-id="A" transform="translate(10, 10)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
        </g>
      </svg>`);
    resizeClusters(svg, 'flowchart LR\n  subgraph sub1\n    A\n  end');
    const box = clusterBBox(svg, 'sub1');
    // A spans x:[0,20] y:[0,20], padded by 24/36/16.
    expect(box.left).toBeCloseTo(-24);
    expect(box.right).toBeCloseTo(44);
  });

  it('resizes nested clusters bottom-up so the parent encompasses the resized child', () => {
    const svg = loadSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <g class="clusters">
          <g class="cluster" id="flowchart-outer-1" transform="translate(0, 0)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
          <g class="cluster" id="flowchart-inner-2" transform="translate(50, 50)">
            <rect x="-40" y="-40" width="80" height="80"></rect>
          </g>
        </g>
        <g class="nodes">
          <g data-node-id="A" transform="translate(10, 10)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
          <g data-node-id="B" transform="translate(90, 10)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
          <g data-node-id="D" transform="translate(150, 100)">
            <rect x="-10" y="-10" width="20" height="20"></rect>
          </g>
        </g>
      </svg>`);
    const src = `
flowchart LR
  subgraph outer
    subgraph inner
      A --> B
    end
    D --> A
  end
`;
    resizeClusters(svg, src);

    const inner = clusterBBox(svg, 'inner');
    const outer = clusterBBox(svg, 'outer');
    // D's node bbox spans x:[140,160] y:[90,110].
    const dBBox = { left: 140, top: 90, right: 160, bottom: 110 };

    // Outer must fully contain the resized inner cluster and node D.
    expect(outer.left).toBeLessThanOrEqual(inner.left);
    expect(outer.top).toBeLessThanOrEqual(inner.top);
    expect(outer.right).toBeGreaterThanOrEqual(inner.right);
    expect(outer.bottom).toBeGreaterThanOrEqual(inner.bottom);
    expect(outer.left).toBeLessThanOrEqual(dBBox.left);
    expect(outer.top).toBeLessThanOrEqual(dBBox.top);
    expect(outer.right).toBeGreaterThanOrEqual(dBBox.right);
    expect(outer.bottom).toBeGreaterThanOrEqual(dBBox.bottom);
  });
});
