import { describe, it, expect } from 'vitest';
import { computeZoomToFit, getSvgDimensions, getVisibleContentDimensions } from './zoomToFit';

describe('computeZoomToFit', () => {
  it('returns zoom=1, pan=0 for zero SVG dimensions', () => {
    const result = computeZoomToFit({
      containerWidth: 800,
      containerHeight: 600,
      svgWidth: 0,
      svgHeight: 0,
    });
    expect(result).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('returns zoom=1, pan=0 for zero container dimensions', () => {
    const result = computeZoomToFit({
      containerWidth: 0,
      containerHeight: 0,
      svgWidth: 400,
      svgHeight: 300,
    });
    expect(result).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('scales down a large SVG to fit in a smaller container', () => {
    const result = computeZoomToFit({
      containerWidth: 800,
      containerHeight: 600,
      svgWidth: 1600,
      svgHeight: 1200,
    });
    // Available = 800 - 40 = 760 wide, 600 - 40 = 560 high (padding = 20 per side)
    // scaleX = 760/1600 = 0.475, scaleY = 560/1200 = 0.467
    // zoom = min(0.475, 0.467) = 0.467
    expect(result.zoom).toBeCloseTo(560 / 1200, 3);
    expect(result.panX).toBe(0);
    expect(result.panY).toBe(0);
  });

  it('scales up a small SVG to fit in a larger container', () => {
    const result = computeZoomToFit({
      containerWidth: 1200,
      containerHeight: 900,
      svgWidth: 200,
      svgHeight: 150,
    });
    // Available = 1200 - 40 = 1160, 900 - 40 = 860
    // scaleX = 1160/200 = 5.8 (clamped to MAX_ZOOM=5)
    // scaleY = 860/150 = 5.73 (clamped to MAX_ZOOM=5)
    // zoom = min(5.8, 5.73) = 5.73 -> clamped to 5
    expect(result.zoom).toBe(5);
    expect(result.panX).toBe(0);
    expect(result.panY).toBe(0);
  });

  it('respects MIN_ZOOM for extremely large SVGs', () => {
    const result = computeZoomToFit({
      containerWidth: 100,
      containerHeight: 100,
      svgWidth: 100000,
      svgHeight: 100000,
    });
    // Available = 60x60, scale = 60/100000 = 0.0006 -> clamped to MIN_ZOOM=0.1
    expect(result.zoom).toBe(0.1);
  });

  it('uses the smaller scale factor for wide SVGs', () => {
    const result = computeZoomToFit({
      containerWidth: 800,
      containerHeight: 600,
      svgWidth: 2000,
      svgHeight: 200,
    });
    // Available = 760 wide, 560 high
    // scaleX = 760/2000 = 0.38, scaleY = 560/200 = 2.8
    // zoom = min(0.38, 2.8) = 0.38
    expect(result.zoom).toBeCloseTo(760 / 2000, 3);
  });

  it('uses the smaller scale factor for tall SVGs', () => {
    const result = computeZoomToFit({
      containerWidth: 800,
      containerHeight: 600,
      svgWidth: 200,
      svgHeight: 2000,
    });
    // Available = 760 wide, 560 high
    // scaleX = 760/200 = 3.8, scaleY = 560/2000 = 0.28
    // zoom = min(3.8, 0.28) = 0.28
    expect(result.zoom).toBeCloseTo(560 / 2000, 3);
  });

  it('always resets pan to zero', () => {
    const result = computeZoomToFit({
      containerWidth: 800,
      containerHeight: 600,
      svgWidth: 800,
      svgHeight: 600,
    });
    expect(result.panX).toBe(0);
    expect(result.panY).toBe(0);
  });
});

describe('getSvgDimensions', () => {
  it('parses viewBox attribute', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1200 800');
    const dims = getSvgDimensions(svg);
    expect(dims).toEqual({ width: 1200, height: 800 });
  });

  it('parses viewBox with negative offsets', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '-50 -30 600 400');
    const dims = getSvgDimensions(svg);
    expect(dims).toEqual({ width: 600, height: 400 });
  });

  it('falls back to width/height attributes', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '500');
    svg.setAttribute('height', '350');
    const dims = getSvgDimensions(svg);
    expect(dims).toEqual({ width: 500, height: 350 });
  });

  it('returns defaults for missing dimensions', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const dims = getSvgDimensions(svg);
    expect(dims).toEqual({ width: 800, height: 600 });
  });
});

describe('getVisibleContentDimensions', () => {
  it('measures only visible nodes, ignores hidden ones', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    // Visible node at (100, 200) with 80x40 shape
    const g1 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g1.setAttribute('data-node-id', 'A');
    g1.setAttribute('transform', 'translate(100, 200)');
    const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r1.setAttribute('width', '80');
    r1.setAttribute('height', '40');
    g1.appendChild(r1);
    svg.appendChild(g1);

    // Hidden node far away at (5000, 5000)
    const g2 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g2.setAttribute('data-node-id', 'B');
    g2.setAttribute('transform', 'translate(5000, 5000)');
    g2.style.display = 'none';
    const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r2.setAttribute('width', '80');
    r2.setAttribute('height', '40');
    g2.appendChild(r2);
    svg.appendChild(g2);

    const dims = getVisibleContentDimensions(svg);
    // Should only measure node A: center at (100,200), shape 80x40
    // Bounds: x=[60,140], y=[180,220] → width=80, height=40
    expect(dims.width).toBe(80);
    expect(dims.height).toBe(40);
  });

  it('includes visible cluster boxes in measurement', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    // Visible node at (100, 100)
    const g1 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g1.setAttribute('data-node-id', 'A');
    g1.setAttribute('transform', 'translate(100, 100)');
    const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r1.setAttribute('width', '80');
    r1.setAttribute('height', '40');
    g1.appendChild(r1);
    svg.appendChild(g1);

    // Cluster box at (400, 100) with 120x40
    const gc = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gc.classList.add('cluster');
    gc.setAttribute('transform', 'translate(400, 100)');
    const rc = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rc.setAttribute('x', '0');
    rc.setAttribute('y', '0');
    rc.setAttribute('width', '120');
    rc.setAttribute('height', '40');
    gc.appendChild(rc);
    svg.appendChild(gc);

    const dims = getVisibleContentDimensions(svg);
    // Node A: x=[60,140], y=[80,120]
    // Cluster: x=[400,520], y=[100,140]
    // Union: x=[60,520], y=[80,140] → width=460, height=60
    expect(dims.width).toBe(460);
    expect(dims.height).toBe(60);
  });

  it('falls back to getSvgDimensions when no visible elements', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1000 800');

    // Only hidden nodes
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-node-id', 'X');
    g.setAttribute('transform', 'translate(500, 500)');
    g.style.display = 'none';
    svg.appendChild(g);

    const dims = getVisibleContentDimensions(svg);
    expect(dims).toEqual({ width: 1000, height: 800 });
  });

  it('handles multiple visible nodes spread across the SVG', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    // Node at (0, 0)
    const g1 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g1.setAttribute('data-node-id', 'A');
    g1.setAttribute('transform', 'translate(0, 0)');
    const r1 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r1.setAttribute('width', '100');
    r1.setAttribute('height', '50');
    g1.appendChild(r1);
    svg.appendChild(g1);

    // Node at (300, 200)
    const g2 = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g2.setAttribute('data-node-id', 'B');
    g2.setAttribute('transform', 'translate(300, 200)');
    const r2 = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r2.setAttribute('width', '100');
    r2.setAttribute('height', '50');
    g2.appendChild(r2);
    svg.appendChild(g2);

    const dims = getVisibleContentDimensions(svg);
    // A: x=[-50,50], y=[-25,25]
    // B: x=[250,350], y=[175,225]
    // Union: x=[-50,350], y=[-25,225] → width=400, height=250
    expect(dims.width).toBe(400);
    expect(dims.height).toBe(250);
  });
});
