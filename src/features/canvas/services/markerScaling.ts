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
      const pathElement = originalMarker.querySelector('path[d]');
      if (pathElement) {
        const pathD = pathElement.getAttribute('d') || '';
        const xCoords = [];
        const regex = /(?:^|\s|,)(\d+\.?\d*)/g;
        let match;
        while ((match = regex.exec(pathD)) !== null) {
          xCoords.push(parseFloat(match[1]));
        }
        const tipX = Math.max(...xCoords);
        if (isFinite(tipX)) {
          // Attach at TIP_ATTACHMENT_RATIO of the tip position for better visual appearance
          originalMarker.setAttribute('refX', String(tipX * TIP_ATTACHMENT_RATIO));
        }
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
    
    // For refX: Find the arrow tip and maintain consistent visual positioning across all scales.
    // Original Mermaid marker: viewBox="0 0 10 10", markerWidth=12, path tip at x=10, refX=6
    // When we remove the viewBox (working in pure user space), we need refX to attach near the tip.
    //
    // For visual consistency: attach slightly before the tip (at TIP_ATTACHMENT_RATIO of tip position).
    // This ensures the line goes through the arrow body rather than just touching the point,
    // which looks better especially at larger scales (4px+).
    
    let refXTarget = origRefX * scaleFactor; // Default fallback
    
    const pathElement = originalMarker.querySelector('path[d]');
    if (pathElement) {
      const pathD = pathElement.getAttribute('d') || '';
      // Find all x-coordinates in the path
      const xCoords = [];
      const regex = /(?:^|\s|,)(\d+\.?\d*)/g;
      let match;
      while ((match = regex.exec(pathD)) !== null) {
        xCoords.push(parseFloat(match[1]));
      }
      
      // The arrow tip is at the maximum x-coordinate in the path
      const origTipX = Math.max(...xCoords);
      if (isFinite(origTipX)) {
        // After scaling, the tip will be at (origTipX * scaleFactor).
        // Attach at TIP_ATTACHMENT_RATIO of the tip position for better visual appearance.
        refXTarget = origTipX * scaleFactor * TIP_ATTACHMENT_RATIO;
      }
    }
    
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

    // Scale circle radius if present, from original (now it's in user space)
    scaledMarker.querySelectorAll('circle[r]').forEach((circle) => {
      const origCircle = originalMarker.querySelector('circle[r]');
      const origRadius = parseFloat(origCircle?.getAttribute('r') || circle.getAttribute('r') || '5');
      circle.setAttribute('r', String(origRadius * scaleFactor));
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
