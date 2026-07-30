/**
 * Small helpers shared by `useEdgeDrag` and its rendering module.
 */
import type { EdgeLineStyle } from '@/shared/types/diagram';

/**
 * Convert a client-space pointer position to SVG root coordinates,
 * honouring the pan/zoom applied by the SVG's `getScreenCTM`. Returns
 * `null` if the browser can't produce a valid CTM (very early frame /
 * detached SVG).
 */
export function svgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): DOMPoint | null {
  try {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM()?.inverse());
  } catch {
    return null;
  }
}

/** Build the `edgeId → EdgeLineStyle` map the router expects. */
export function buildLineStyleMap(
  edgeStyles: Record<string, { lineStyle?: EdgeLineStyle }>,
): Map<string, EdgeLineStyle> {
  const m = new Map<string, EdgeLineStyle>();
  Object.entries(edgeStyles).forEach(([id, s]) => {
    if (s.lineStyle) m.set(id, s.lineStyle);
  });
  return m;
}

/**
 * Escape characters that would break out of an attribute-selector quote
 * (`"` and `\`). Suitable for building `[attr="…"]` selectors from a
 * value read out of another attribute.
 */
export function cssEscape(v: string): string {
  return v.replace(/["\\]/g, '\\$&');
}
