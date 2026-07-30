/**
 * SVG `transform="translate(x, y)"` parser — the only form Mermaid emits
 * for node groups and inner shapes. We deliberately do NOT support the full
 * SVG transform grammar (matrices, rotations, scales) because Mermaid never
 * uses those on node/shape elements, and supporting them would drag in a
 * dependency for micro-optimising a case that never arises.
 *
 * If Mermaid ever changes convention we'll catch it via the router
 * regression tests — they draw a real diamond and assert its bbox.
 */
import type { Point } from '@/shared/types/diagram';

const TRANSLATE_RE = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/;

/**
 * Parse a `translate(x, y)` (or `translate(x,y)`) transform. Returns
 * `{ x: 0, y: 0 }` when the attribute is missing or doesn't match — the
 * identity translate.
 */
export function parseTranslate(transform: string | null | undefined): Point {
  if (!transform) return { x: 0, y: 0 };
  const m = TRANSLATE_RE.exec(transform);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
}
