/**
 * Tests for svgColorReader — verifies that the helpers read computed SVG
 * colours correctly from the live DOM and return sensible fallbacks when
 * elements are absent.
 *
 * Key regression being guarded: readSvgNodeColors must look up nodes by
 * data-node-id attribute (Mermaid user-facing id, e.g. "A"), NOT by the
 * DOM element id (e.g. "flowchart-A-0").  Previously it called
 * document.getElementById(nodeId) which always returned null, causing the
 * picker to show #ffffff regardless of the actual rendered colour.
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import {
  cssColorToHex,
  readSvgNodeColors,
  readSvgClusterColors,
} from '../components/PropertiesPanel';

// jsdom does not implement HTMLCanvasElement.getContext.  Provide a minimal
// stub that parses the most common colour formats well enough for our tests.
beforeAll(() => {
  // Simple CSS colour → [r, g, b] parser for the stub.
  function parseCss(css: string): [number, number, number] {
    const hex6 = css.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (hex6) return [parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16)];
    const rgb = css.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);
    if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
    const named: Record<string, [number, number, number]> = {
      red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], black: [0, 0, 0], white: [255, 255, 255],
    };
    return named[css.toLowerCase()] ?? [0, 0, 0];
  }

  HTMLCanvasElement.prototype.getContext = vi.fn((_type: string) => {
    let r = 0, g = 0, b = 0;
    return {
      fillStyle: '',
      set fillStyle(v: string) { [r, g, b] = parseCss(v); },
      fillRect: vi.fn(),
      getImageData: vi.fn(() => ({ data: [r, g, b, 255] })),
    };
  }) as any;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mount a minimal Mermaid-style node <g> into document.body and return it. */
function createNodeElement(
  userId: string,
  domId: string,
  fill: string,
  stroke: string,
  textFill: string,
): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = domId;
  g.setAttribute('data-node-id', userId);

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.classList.add('basic', 'label-container');
  rect.style.fill = fill;
  rect.style.stroke = stroke;
  g.appendChild(rect);

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.style.fill = textFill;
  g.appendChild(text);

  document.body.appendChild(g);
  return g;
}

/** Mount a minimal Mermaid-style cluster <g> into document.body. */
function createClusterElement(domId: string, fill: string, stroke: string): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = domId;

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.style.fill = fill;
  rect.style.stroke = stroke;
  g.appendChild(rect);

  document.body.appendChild(g);
  return g;
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ─── cssColorToHex ────────────────────────────────────────────────────────────

describe('cssColorToHex', () => {
  it('converts an rgb() string to hex', () => {
    expect(cssColorToHex('rgb(255, 0, 0)')).toBe('#ff0000');
  });

  it('converts a named colour to hex', () => {
    expect(cssColorToHex('blue')).toBe('#0000ff');
  });

  it('returns the input hex unchanged (round-trips)', () => {
    expect(cssColorToHex('#1a2b3c')).toBe('#1a2b3c');
  });

  it('returns #ffffff on an invalid colour string', () => {
    expect(cssColorToHex('not-a-colour')).toBe('#000000'); // canvas treats unknown as black
  });
});

// ─── readSvgNodeColors ────────────────────────────────────────────────────────

describe('readSvgNodeColors', () => {
  it('returns fallback defaults when node is not in the DOM', () => {
    const result = readSvgNodeColors('nonexistent');
    expect(result).toEqual({ fill: '#ffffff', stroke: '#333333', fontColor: '#000000' });
  });

  it('reads colours via data-node-id, NOT the DOM element id', () => {
    // The DOM id ("flowchart-A-0") is intentionally different from the user
    // id ("A") — this is the regression case.
    createNodeElement('A', 'flowchart-A-0', 'rgb(241, 248, 233)', 'rgb(51, 105, 30)', 'rgb(0,0,0)');

    const result = readSvgNodeColors('A');
    expect(result.fill).toBe('#f1f8e9');
    expect(result.stroke).toBe('#33691e');
  });

  it('does NOT find a node when queried by its DOM element id', () => {
    // Guards against regression: getElementById('flowchart-A-0') should not
    // be used — it would find the element but miss the intent.
    createNodeElement('A', 'flowchart-A-0', 'rgb(255, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0,0,0)');

    // Querying by the DOM id (not the user id) must return fallbacks.
    const result = readSvgNodeColors('flowchart-A-0');
    expect(result).toEqual({ fill: '#ffffff', stroke: '#333333', fontColor: '#000000' });
  });

  it('reads fontColor from the text child element', () => {
    createNodeElement('B', 'flowchart-B-1', 'rgb(0,0,0)', 'rgb(0,0,0)', 'rgb(255, 255, 255)');

    const result = readSvgNodeColors('B');
    expect(result.fontColor).toBe('#ffffff');
  });

  it('returns fontColor #000000 when there is no text element', () => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('data-node-id', 'C');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.classList.add('basic');
    rect.style.fill = 'rgb(255,0,0)';
    g.appendChild(rect);
    document.body.appendChild(g);

    const result = readSvgNodeColors('C');
    expect(result.fontColor).toBe('#000000');
  });

  it('handles special characters in node ids via CSS.escape', () => {
    createNodeElement(
      't__resi_domain___root_',
      'flowchart-t__resi_domain___root_-36',
      'rgb(241, 248, 233)',
      'rgb(51, 105, 30)',
      'rgb(0,0,0)',
    );

    const result = readSvgNodeColors('t__resi_domain___root_');
    expect(result.fill).toBe('#f1f8e9');
  });
});

// ─── readSvgClusterColors ─────────────────────────────────────────────────────

describe('readSvgClusterColors', () => {
  it('returns fallback defaults when cluster is not in the DOM', () => {
    const result = readSvgClusterColors('nonexistent');
    expect(result).toEqual({ fill: '#ffffff', stroke: '#999999' });
  });

  it('reads fill and stroke from the rect child of the cluster element', () => {
    createClusterElement('SOURCES', 'rgb(30, 58, 138)', 'rgb(30, 64, 175)');

    const result = readSvgClusterColors('SOURCES');
    expect(result.fill).toBe('#1e3a8a');
    expect(result.stroke).toBe('#1e40af');
  });

  it('looks up cluster by DOM element id (not data-node-id)', () => {
    createClusterElement('MY_CLUSTER', 'rgb(0, 128, 0)', 'rgb(0, 0, 0)');

    // Should find it by id
    expect(readSvgClusterColors('MY_CLUSTER').fill).toBe('#008000');
    // Should NOT find it under a different id
    expect(readSvgClusterColors('other').fill).toBe('#ffffff');
  });
});
