import { describe, it, expect } from 'vitest';
import { computeZoomToFit, getSvgDimensions } from './zoomToFit';

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
    // Available = 800 - 80 = 720 wide, 600 - 80 = 520 high
    // scaleX = 720/1600 = 0.45, scaleY = 520/1200 = 0.433
    // zoom = min(0.45, 0.433) = 0.433
    expect(result.zoom).toBeCloseTo(520 / 1200, 3);
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
    // Available = 1200 - 80 = 1120, 900 - 80 = 820
    // scaleX = 1120/200 = 5.6 (clamped to MAX_ZOOM=5)
    // scaleY = 820/150 = 5.467 (clamped to MAX_ZOOM=5)
    // zoom = min(5.6, 5.467) = 5.467 -> clamped to 5
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
    // Available = 20x20, scale = 20/100000 = 0.0002 -> clamped to MIN_ZOOM=0.1
    expect(result.zoom).toBe(0.1);
  });

  it('uses the smaller scale factor for wide SVGs', () => {
    const result = computeZoomToFit({
      containerWidth: 800,
      containerHeight: 600,
      svgWidth: 2000,
      svgHeight: 200,
    });
    // Available = 720 wide, 520 high
    // scaleX = 720/2000 = 0.36, scaleY = 520/200 = 2.6
    // zoom = min(0.36, 2.6) = 0.36
    expect(result.zoom).toBeCloseTo(720 / 2000, 3);
  });

  it('uses the smaller scale factor for tall SVGs', () => {
    const result = computeZoomToFit({
      containerWidth: 800,
      containerHeight: 600,
      svgWidth: 200,
      svgHeight: 2000,
    });
    // Available = 720 wide, 520 high
    // scaleX = 720/200 = 3.6, scaleY = 520/2000 = 0.26
    // zoom = min(3.6, 0.26) = 0.26
    expect(result.zoom).toBeCloseTo(520 / 2000, 3);
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
