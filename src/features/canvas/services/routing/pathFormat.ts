/**
 * Shared numeric formatter for SVG `d` strings.
 *
 * Kept in its own module so every path emitter agrees on precision — path
 * strings that round differently would look identical to the eye but
 * churn the DOM on every render.
 */
export function fmt(n: number): string {
  // 2 decimal places is enough for sub-pixel accuracy at any zoom level
  // we ship, and keeps SVG mark-up compact.
  return String(Math.round(n * 100) / 100);
}

/**
 * Clamp `bend` control-arm length to a comfortable band regardless of
 * endpoint separation:
 *   - short edges get a minimum bend so the curve isn't a straight line;
 *   - long edges get a maximum bend so they don't wrap around themselves.
 */
export function bendFor(dx: number, dy: number): number {
  return Math.max(30, Math.min(120, Math.hypot(dx, dy) * 0.4));
}
