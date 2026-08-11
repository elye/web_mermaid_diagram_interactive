/**
 * zoomToFit — compute the viewport (zoom + pan) needed to fit the current
 * diagram content into the visible container area.
 *
 * This is a pure calculation module. It reads the bounding box of VISIBLE
 * content and the container's bounding rect, then returns the `ViewportState`
 * that would center and scale the content to fit.
 */
import type { ViewportState } from '@/shared/types/diagram';
import { MIN_ZOOM, MAX_ZOOM } from '@/shared/constants/defaults';

/** Padding (px) left on each side so content doesn't touch the edge. */
const FIT_PADDING = 20;

export interface FitInput {
  /** Container element width in px. */
  containerWidth: number;
  /** Container element height in px. */
  containerHeight: number;
  /** Content width to fit. */
  svgWidth: number;
  /** Content height to fit. */
  svgHeight: number;
}

/**
 * Calculate the viewport state that fits the content within the container.
 *
 * The DiagramCanvas layout centers the SVG host (via CSS left: 50%, top: 50%,
 * translate(-50%, -50%)) and then applies viewport pan/zoom on top. So when
 * panX = 0 and panY = 0, the content is already centered; we just need to
 * compute the right zoom level.
 */
export function computeZoomToFit(input: FitInput): ViewportState {
  const { containerWidth, containerHeight, svgWidth, svgHeight } = input;

  // Guard against zero dimensions.
  if (svgWidth <= 0 || svgHeight <= 0 || containerWidth <= 0 || containerHeight <= 0) {
    return { zoom: 1, panX: 0, panY: 0 };
  }

  // Available space after padding.
  const availableWidth = Math.max(1, containerWidth - FIT_PADDING * 2);
  const availableHeight = Math.max(1, containerHeight - FIT_PADDING * 2);

  // Scale factor to fit both axes.
  const scaleX = availableWidth / svgWidth;
  const scaleY = availableHeight / svgHeight;
  const zoom = Math.min(scaleX, scaleY);

  // Clamp to allowed range.
  const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

  // Reset pan — the CSS centering will handle alignment.
  return { zoom: clampedZoom, panX: 0, panY: 0 };
}

/**
 * Read the SVG dimensions from the live SVG element.
 * Prefers viewBox, falls back to width/height attributes.
 */
export function getSvgDimensions(svgEl: SVGSVGElement): { width: number; height: number } {
  const vb = svgEl.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  // Fallback to inline width/height.
  const w = parseFloat(svgEl.getAttribute('width') ?? '0');
  const h = parseFloat(svgEl.getAttribute('height') ?? '0');
  return { width: w || 800, height: h || 600 };
}

/**
 * Compute the bounding box of only VISIBLE content in the SVG.
 *
 * This measures visible nodes (not display:none) and visible collapsed
 * cluster boxes, ignoring hidden elements inside collapsed subgraphs.
 * This gives an accurate content size for zoom-to-fit when clusters
 * are collapsed (the SVG viewBox is typically inflated by hidden nodes).
 *
 * Returns the width and height of the tight bounding box around visible content.
 * Falls back to getSvgDimensions if no visible elements are found.
 */
export function getVisibleContentDimensions(svgEl: SVGSVGElement): { width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let foundAny = false;

  // Measure visible nodes.
  svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
    if (g.style.display === 'none') return;
    // Read transform to get position.
    const transform = g.getAttribute('transform') ?? '';
    const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
    if (!m) return;
    const tx = Number(m[1]);
    const ty = Number(m[2]);

    // Get shape dimensions from first shape child.
    const shape = g.querySelector('rect, polygon, circle, ellipse, path');
    let w = 100, h = 50; // fallback
    if (shape) {
      const sw = shape.getAttribute('width');
      const sh = shape.getAttribute('height');
      if (sw && sh) {
        w = parseFloat(sw);
        h = parseFloat(sh);
      } else {
        // For shapes without width/height (polygons, circles), estimate from points or r.
        const r = shape.getAttribute('r');
        if (r) { w = h = parseFloat(r) * 2; }
      }
    }

    const x = tx - w / 2;
    const y = ty - h / 2;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
    foundAny = true;
  });

  // Measure visible cluster boxes (collapsed clusters are still visible as small rects).
  svgEl.querySelectorAll<SVGGElement>('g.cluster').forEach((g) => {
    if (g.style.display === 'none') return;
    const transform = g.getAttribute('transform') ?? '';
    const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(transform);
    const tx = m ? Number(m[1]) : 0;
    const ty = m ? Number(m[2]) : 0;

    const rect = g.querySelector(':scope > rect');
    if (!rect) return;
    const rw = parseFloat(rect.getAttribute('width') ?? '0');
    const rh = parseFloat(rect.getAttribute('height') ?? '0');
    if (rw <= 0 || rh <= 0) return;

    const rx = parseFloat(rect.getAttribute('x') ?? String(-rw / 2));
    const ry = parseFloat(rect.getAttribute('y') ?? String(-rh / 2));

    minX = Math.min(minX, tx + rx);
    minY = Math.min(minY, ty + ry);
    maxX = Math.max(maxX, tx + rx + rw);
    maxY = Math.max(maxY, ty + ry + rh);
    foundAny = true;
  });

  if (!foundAny) {
    return getSvgDimensions(svgEl);
  }

  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}
