/**
 * markerScaling — scales SVG arrow markers proportionally to edge stroke width.
 *
 * When users change an edge's stroke width, the arrow markers at the end of
 * the edge should scale proportionally so they remain visually balanced.
 *
 * Strategy:
 * 1. When stroke width changes, calculate the scale factor:
 *    scale = currentStrokeWidth / baseStrokeWidth
 *    (baseStrokeWidth for Mermaid is typically 2px)
 * 2. Find the ORIGINAL marker (extracting any __scaled- suffix)
 * 3. Clone from the original if not already cloned, then scale its geometry:
 *    - markerWidth, markerHeight, refX, refY all scale by the same factor
 *    - The inner path's stroke-width also scales
 * 4. Update the edge path's marker-end to point to the scaled marker
 */

const BASE_STROKE_WIDTH = 2;

/**
 * Attachment ratio: the line attaches at this percentage of the arrow tip position.
 * 85% means the line attaches slightly before the tip, ensuring it goes through
 * the arrow body rather than just touching the point, which looks better at all scales.
 */
const TIP_ATTACHMENT_RATIO = 0.85;

/**
 * Extract the original marker ID by removing any __scaled-XXX suffix.
 * E.g., "mf-render-2_flowchart-pointEnd__scaled-150" -> "mf-render-2_flowchart-pointEnd"
 */
function getOriginalMarkerId(markerId: string): string {
  return markerId.replace(/__scaled-\d+$/, '');
}

/**
 * Given a marker path's `d` attribute, return the x-coordinate of the arrow tip.
 *
 * For marker-end arrows (e.g. `M 0 0 L 10 5 L 0 10 z`) the tip is at the
 * MAX x-coordinate (rightmost lone vertex). For marker-start arrows (reversed,
 * e.g. `M 0 5 L 10 10 L 10 0 z`) the tip is at the MIN x-coordinate.
 *
 * For symmetric markers (e.g. a cross `x`) where both extremes appear the same
 * number of times, there is no single tip — returns NaN to signal that the
 * caller should use center-based positioning instead.
 *
 * Detection strategy: parse all absolute M/L vertices, then check whether the
 * lone (unique) x-extreme is at min or max. If minCount === maxCount the
 * shape is symmetric and NaN is returned.
 */
function getTipX(pathD: string): number {
  // Extract all (x, y) pairs from absolute M/L commands only.
  const vertices: number[] = [];
  const re = /[ML]\s*([\d.]+)[,\s]+([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathD)) !== null) {
    vertices.push(parseFloat(m[1]));
  }
  if (vertices.length === 0) return NaN;

  const minX = Math.min(...vertices);
  const maxX = Math.max(...vertices);

  // Count how many vertices share the min vs max x.
  const minCount = vertices.filter((x) => Math.abs(x - minX) < 0.01).length;
  const maxCount = vertices.filter((x) => Math.abs(x - maxX) < 0.01).length;

  // Symmetric marker (e.g. cross): both extremes appear equally — no single tip.
  if (minCount === maxCount) return NaN;

  // The tip is the lone extreme: unique x = the pointy end of the triangle.
  // start-marker: tip at min-x (appears once), base at max-x (appears twice).
  // end-marker:   tip at max-x (appears once), base at min-x (appears twice).
  if (minCount < maxCount) return minX;
  return maxX;
}

/**
 * Return the x range [minX, maxX] of the absolute M/L vertices in a path.
 * Returns null if no vertices are found.
 */
function getPathXRange(pathD: string): { minX: number; maxX: number } | null {
  const vertices: number[] = [];
  const re = /[ML]\s*([\d.]+)[,\s]+([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathD)) !== null) {
    vertices.push(parseFloat(m[1]));
  }
  if (vertices.length === 0) return null;
  return { minX: Math.min(...vertices), maxX: Math.max(...vertices) };
}

/**
 * Compute the refX attachment point for a marker given its original geometry
 * (with viewBox still present). Returns the refX value in path/viewBox user space.
 *
 * - Arrow markers (triangles): refX at TIP_ATTACHMENT_RATIO of the tip.
 * - Circle markers (o): refX at the tangent edge (cx + r for end, cx - r for start).
 * - Symmetric markers (cross x): preserve the original refX as a ratio of markerWidth,
 *   mapping it into path coordinate space so it scales proportionally.
 *
 * All coordinates are in the marker's ORIGINAL viewBox/path user space.
 */
function computeOrigRefX(marker: SVGMarkerElement): number | null {
  // Circle marker (o--o)?
  const circle = marker.querySelector('circle');
  if (circle) {
    const cx = parseFloat(circle.getAttribute('cx') || '5');
    const r  = parseFloat(circle.getAttribute('r')  || '5');
    // Detect end- vs start-marker by whether original refX is closer to right or left edge.
    const origRefX = parseFloat(marker.getAttribute('refX') || '0');
    const rightEdge = cx + r;
    const leftEdge  = cx - r;
    const useRight  = Math.abs(origRefX - rightEdge) <= Math.abs(origRefX - leftEdge);
    return useRight ? rightEdge : leftEdge;
  }

  // Path-based marker?
  const pathEl = marker.querySelector('path[d]');
  if (!pathEl) return null;
  const pathD = pathEl.getAttribute('d') || '';

  const tipX = getTipX(pathD);
  if (isFinite(tipX)) {
    // Arrow-style marker — attach slightly before the tip.
    return tipX * TIP_ATTACHMENT_RATIO;
  }

  // Symmetric marker (e.g. cross x--x): preserve the original refX ratio.
  // The original refX is defined in marker units; convert it to path/viewBox
  // user space so it scales correctly when the geometry is scaled.
  // Ratio = origRefX / markerWidth; path user space width = maxX (from getPathXRange).
  const range = getPathXRange(pathD);
  if (range) {
    const origRefX  = parseFloat(marker.getAttribute('refX')   || '0');
    const origWidth = parseFloat(marker.getAttribute('markerWidth') || String(range.maxX));
    // Map marker-unit refX into path-coordinate space.
    const ratio = origWidth > 0 ? origRefX / origWidth : 0.5;
    return ratio * range.maxX;
  }

  return null;
}

/**
 * Scale a marker by the given scale factor, creating a scaled clone if needed.
 * Returns the id of the (possibly new) scaled marker.
 *
 * IMPORTANT: This function always scales from the ORIGINAL marker (by ID),
 * never from an already-scaled clone. This prevents compounding/exponential growth.
 */
export function scaleMarker(
  marker: SVGMarkerElement,
  scaleFactor: number,
  svg: SVGSVGElement,
): string {
  // Get the original marker ID (strip any __scaled- suffix to avoid chaining).
  const originalId = getOriginalMarkerId(marker.id);
  const originalMarker =
    originalId === marker.id ? marker : (svg.ownerDocument?.getElementById(originalId) as SVGMarkerElement);

  if (!originalMarker) {
    // Shouldn't happen, but fallback to the current marker's original dimensions.
    return marker.id;
  }

  // If scale is 1 or very close, we still need to fix the original marker's refX
  // because Mermaid's original marker has refX=6 which is designed for viewBox scaling,
  // but we work in pure user space. We attach at TIP_ATTACHMENT_RATIO of the tip for better appearance.
  if (Math.abs(scaleFactor - 1) < 0.01) {
    // Fix the original marker's refX if not already fixed
    if (!originalMarker.hasAttribute('data-refx-fixed')) {
      const origRefX = computeOrigRefX(originalMarker);
      if (origRefX !== null) {
        // Attach at the computed position (already includes TIP_ATTACHMENT_RATIO for arrows,
        // or uses edge/center for circles/crosses).
        originalMarker.setAttribute('refX', String(origRefX));
      }
      originalMarker.setAttribute('data-refx-fixed', 'true');
    }
    return marker.id;
  }

  // Create a scaled clone marker with a unique id.
  const scaledId = `${originalId}__scaled-${Math.round(scaleFactor * 100)}`;
  let scaledMarker = svg.ownerDocument?.getElementById(scaledId) as SVGMarkerElement | null;

  if (!scaledMarker) {
    scaledMarker = originalMarker.cloneNode(true) as SVGMarkerElement;
    scaledMarker.id = scaledId;

    // Scale marker geometry from ORIGINAL values.
    const origWidth = parseFloat(originalMarker.getAttribute('markerWidth') || '12');
    const origHeight = parseFloat(originalMarker.getAttribute('markerHeight') || '12');
    const origRefX = parseFloat(originalMarker.getAttribute('refX') || '0');
    const origRefY = parseFloat(originalMarker.getAttribute('refY') || '0');

    const scaledWidth = origWidth * scaleFactor;
    const scaledHeight = origHeight * scaleFactor;

    scaledMarker.setAttribute('markerWidth', String(scaledWidth));
    scaledMarker.setAttribute('markerHeight', String(scaledHeight));
    
    // For userSpaceOnUse markers, removing the viewBox prevents conflicting scaling.
    scaledMarker.removeAttribute('viewBox');
    
    // For refX: compute from the original marker's geometry (arrow tip, circle edge,
    // or symmetric center) and scale proportionally.
    const origRefXComputed = computeOrigRefX(originalMarker);
    // origRefXComputed is in the ORIGINAL marker's path/viewBox user space.
    // After scaling the geometry by scaleFactor, multiply it by scaleFactor too.
    const refXTarget = origRefXComputed !== null
      ? origRefXComputed * scaleFactor
      : origRefX * scaleFactor; // Ultimate fallback: scale the raw attribute value
    
    scaledMarker.setAttribute('refX', String(refXTarget));
    
    // Scale refY proportionally to maintain vertical centering
    scaledMarker.setAttribute('refY', String(origRefY * scaleFactor));

    // Since we removed the viewBox, we now need to scale the path coordinates
    // to match the new marker size. The path data will be in user space coordinates.
    
    scaledMarker.querySelectorAll('path[d]').forEach((path, idx) => {
      const paths = originalMarker.querySelectorAll('path[d]');
      const origPath = paths[idx];
      const origD = origPath?.getAttribute('d') || '';
      
      // Scale all numeric coordinates in the path data
      const scaledD = origD.replace(/(\d+\.?\d*)/g, (match) => {
        const num = parseFloat(match);
        return String(num * scaleFactor);
      });
      path.setAttribute('d', scaledD);
      
      // Keep stroke-width at 1 for crisp arrows
      const origStrokeWidth = parseFloat(origPath?.getAttribute('stroke-width') || '1');
      path.setAttribute('stroke-width', String(origStrokeWidth));
    });

    // Scale circle geometry (cx, cy, r) proportionally, from original values.
    scaledMarker.querySelectorAll('circle').forEach((circle, idx) => {
      const origCircles = originalMarker.querySelectorAll('circle');
      const origCircle = origCircles[idx] ?? origCircles[0];
      const origCx = parseFloat(origCircle?.getAttribute('cx') || circle.getAttribute('cx') || '5');
      const origCy = parseFloat(origCircle?.getAttribute('cy') || circle.getAttribute('cy') || '5');
      const origR  = parseFloat(origCircle?.getAttribute('r')  || circle.getAttribute('r')  || '5');
      circle.setAttribute('cx', String(origCx * scaleFactor));
      circle.setAttribute('cy', String(origCy * scaleFactor));
      circle.setAttribute('r',  String(origR  * scaleFactor));
    });

    // Insert the scaled marker right after the original.
    originalMarker.parentElement?.insertBefore(scaledMarker, originalMarker.nextSibling);
  }

  return scaledId;
}

/**
 * Apply marker scaling to an edge path based on its stroke width.
 * If stroke width matches the base, uses the original marker.
 * Otherwise, creates/reuses a scaled marker clone.
 */
export function applyMarkerScaling(
  edgePath: SVGPathElement,
  strokeWidth: number,
  svg: SVGSVGElement,
): void {
  const markerEndRef = edgePath.getAttribute('marker-end');
  if (!markerEndRef) return; // No marker to scale.

  // Extract the marker id from "url(#id)".
  const markerMatch = markerEndRef.match(/url\(#([^)]+)\)/);
  if (!markerMatch) return;

  // Get the current marker ID (which might already have a __scaled- suffix).
  let currentMarkerId = markerMatch[1];
  
  // Get the original marker (by stripping __scaled- suffix if present)
  const originalMarkerId = getOriginalMarkerId(currentMarkerId);
  const originalMarker = svg.ownerDocument?.getElementById(originalMarkerId) as SVGMarkerElement | null;
  if (!originalMarker) return;

  const scaleFactor = strokeWidth / BASE_STROKE_WIDTH;
  const scaledMarkerId = scaleMarker(originalMarker, scaleFactor, svg);

  if (scaledMarkerId !== currentMarkerId) {
    edgePath.setAttribute('marker-end', `url(#${scaledMarkerId})`);
  }
}

/**
 * Apply marker scaling to a marker-start attribute as well (if present).
 */
export function applyMarkerStartScaling(
  edgePath: SVGPathElement,
  strokeWidth: number,
  svg: SVGSVGElement,
): void {
  const markerStartRef = edgePath.getAttribute('marker-start');
  if (!markerStartRef) return;

  const markerMatch = markerStartRef.match(/url\(#([^)]+)\)/);
  if (!markerMatch) return;

  // Get the current marker ID (which might already have a __scaled- suffix).
  let currentMarkerId = markerMatch[1];
  
  // Get the original marker (by stripping __scaled- suffix if present)
  const originalMarkerId = getOriginalMarkerId(currentMarkerId);
  const originalMarker = svg.ownerDocument?.getElementById(originalMarkerId) as SVGMarkerElement | null;
  if (!originalMarker) return;

  const scaleFactor = strokeWidth / BASE_STROKE_WIDTH;
  const scaledMarkerId = scaleMarker(originalMarker, scaleFactor, svg);

  if (scaledMarkerId !== currentMarkerId) {
    edgePath.setAttribute('marker-start', `url(#${scaledMarkerId})`);
  }
}
