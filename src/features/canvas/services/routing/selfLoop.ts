/**
 * `selfLoopPath` — kidney-shaped loop for edges whose source and target
 * are the same node (`D --> D`).
 *
 * Two modes:
 *   • No waypoint → classic right-side kidney. Grows outward so the edge
 *     label sits clear of the node when the label is wide.
 *   • With waypoint → the loop's two endpoints slide around the node
 *     perimeter to sit on the side facing the waypoint, straddling the
 *     centre-to-waypoint direction. The curve is a quadratic Bézier
 *     routed THROUGH the waypoint (Miro-style inverse-solve) so the drag
 *     handle stays on the line at all times.
 */
import type { BBox, Point } from '@/shared/types/diagram';
import { fmt } from './pathFormat';

/**
 * @param rect        The node's axis-aligned bounding rect.
 * @param waypoint    Optional user-dragged control point.
 * @param labelWidth  Approximate label width in SVG user units. When
 *                    non-zero (and no waypoint is set) the default loop
 *                    grows so its peak sits clear of the label.
 */
export function selfLoopPath(rect: BBox, waypoint?: Point, labelWidth = 0): string {
  return waypoint
    ? loopThroughWaypoint(rect, waypoint)
    : defaultRightSideLoop(rect, labelWidth);
}

// ---------------------------------------------------------------- internals

/** Bounds on the size of the default kidney relative to the node height. */
const MIN_LOOP_SIZE = 20;
const MAX_LOOP_SIZE = 40;
const LOOP_HEIGHT_FACTOR = 0.7;
/** Padding between the loop's peak and the edge label. */
const LABEL_MARGIN = 12;
/** Perpendicular gap between the two endpoints of a waypoint-driven loop. */
const MIN_ENDPOINT_GAP = 8;
const MAX_ENDPOINT_GAP = 24;
const ENDPOINT_GAP_FACTOR = 0.25;

function defaultRightSideLoop(rect: BBox, labelWidth: number): string {
  const cy = rect.y + rect.height / 2;
  const rightX = rect.x + rect.width;

  const baseSize = Math.max(MIN_LOOP_SIZE, Math.min(MAX_LOOP_SIZE, rect.height * LOOP_HEIGHT_FACTOR));
  // Peak sits at ~ rightX + size. Bump size so the label's right edge
  // stays clear of the node.
  const requiredForLabel = labelWidth > 0 ? labelWidth / 2 + LABEL_MARGIN : 0;
  const size = Math.max(baseSize, requiredForLabel);

  const startY = cy - size * 0.25;
  const endY = cy + size * 0.25;
  const outX = rightX + size;
  return (
    `M ${fmt(rightX)} ${fmt(startY)}` +
    ` C ${fmt(outX)} ${fmt(cy - size)}, ${fmt(outX)} ${fmt(cy + size)}, ${fmt(rightX)} ${fmt(endY)}`
  );
}

function loopThroughWaypoint(rect: BBox, waypoint: Point): string {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = waypoint.x - cx;
  const dy = waypoint.y - cy;
  const dlen = Math.hypot(dx, dy) || 1;
  const dirX = dx / dlen;
  const dirY = dy / dlen;

  // Peak: where the ray (centre → waypoint) meets the bbox perimeter.
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const tX = Math.abs(dirX) > 1e-6 ? halfW / Math.abs(dirX) : Infinity;
  const tY = Math.abs(dirY) > 1e-6 ? halfH / Math.abs(dirY) : Infinity;
  const t = Math.min(tX, tY);
  const peak: Point = { x: cx + dirX * t, y: cy + dirY * t };

  // Endpoints straddle `peak` along the direction perpendicular to
  // `dir`. Gap is a small fraction of the node size, clamped so tiny
  // nodes still get visible anchors and huge nodes don't sprout wide
  // ones.
  const perpX = -dirY;
  const perpY = dirX;
  const gap = Math.max(
    MIN_ENDPOINT_GAP,
    Math.min(MAX_ENDPOINT_GAP, Math.min(rect.width, rect.height) * ENDPOINT_GAP_FACTOR),
  );

  const start = clampToBBoxPerimeter(rect, { x: peak.x + perpX * gap, y: peak.y + perpY * gap });
  const end = clampToBBoxPerimeter(rect, { x: peak.x - perpX * gap, y: peak.y - perpY * gap });

  return quadraticThroughPoint(start, waypoint, end);
}

/**
 * Snap a point that is already close to the bbox perimeter onto its
 * nearest side (top / right / bottom / left). Cardinal directions land
 * ON the perimeter naturally; diagonals get clamped so the loop's
 * endpoints don't hover just outside the box.
 */
function clampToBBoxPerimeter(rect: BBox, p: Point): Point {
  const x = Math.max(rect.x, Math.min(rect.x + rect.width, p.x));
  const y = Math.max(rect.y, Math.min(rect.y + rect.height, p.y));
  const distTop = Math.abs(y - rect.y);
  const distBottom = Math.abs(y - (rect.y + rect.height));
  const distLeft = Math.abs(x - rect.x);
  const distRight = Math.abs(x - (rect.x + rect.width));
  const min = Math.min(distTop, distBottom, distLeft, distRight);
  if (min === distTop) return { x, y: rect.y };
  if (min === distBottom) return { x, y: rect.y + rect.height };
  if (min === distLeft) return { x: rect.x, y };
  return { x: rect.x + rect.width, y };
}

/**
 * Quadratic Bézier from `p0` to `p2` that PASSES THROUGH `m` (Miro-style
 * inverse solve). The control point is derived from the classic
 * de Casteljau relation at t = 0.5:
 *   m = 0.25·p0 + 0.5·cp + 0.25·p2   ⇒   cp = 2m − 0.5(p0 + p2).
 */
function quadraticThroughPoint(p0: Point, m: Point, p2: Point): string {
  const cp: Point = {
    x: 2 * m.x - 0.5 * (p0.x + p2.x),
    y: 2 * m.y - 0.5 * (p0.y + p2.y),
  };
  return `M ${fmt(p0.x)} ${fmt(p0.y)} Q ${fmt(cp.x)} ${fmt(cp.y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
}
