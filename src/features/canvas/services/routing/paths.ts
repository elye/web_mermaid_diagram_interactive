/**
 * Path shape emitters — pure functions from geometry to SVG `d` strings.
 * Kept UI-agnostic: routers may pick between these based on edge topology.
 *
 * Supported styles:
 *   bezierPath      — smooth cubic bezier (default, "curve")
 *   straightPath    — single straight line segment
 *   orthogonalPath  — two axis-aligned segments (L-shaped / Z-shaped)
 *   waypointCurvePath — cubic bezier routed through a user-dragged midpoint
 *   selfLoopPath    — kidney loop for self-edges
 */
import type { BBox, Point } from '@/shared/types/diagram';

/**
 * Smooth cubic bezier between two anchor points. Control points are
 * offset in the "outgoing" direction of the anchor to produce clean
 * S-curves for L→R / T→B / diagonal edges alike.
 *
 * The bend distance is proportional to the endpoint separation but
 * clamped to [30, 120] so short edges don't look sharp and long edges
 * don't overshoot.
 *
 * Optional `srcTangent` / `tgtTangent` are unit outward normals — the
 * direction the curve should exit `a` (respectively, the direction from
 * `b` pointing back toward the incoming curve). When supplied, they
 * override the axis-picking heuristic so the curve always leaves/enters
 * perpendicular to the anchored side (top/bottom → vertical exit,
 * left/right → horizontal exit).
 */
export function bezierPath(
  a: Point,
  b: Point,
  srcTangent?: Point,
  tgtTangent?: Point,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const bend = Math.max(30, Math.min(120, Math.hypot(dx, dy) * 0.4));

  // Endpoint tangents:
  //   src → outward direction the curve leaves `a`.
  //   tgt → outward direction from `b` toward the incoming curve.
  // If not provided, fall back to the axis-dominance heuristic (matches
  // legacy behavior and looks reasonable for plain rectangles).
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const srcT: Point =
    srcTangent ??
    (horizontal
      ? { x: Math.sign(dx) || 1, y: 0 }
      : { x: 0, y: Math.sign(dy) || 1 });
  const tgtT: Point =
    tgtTangent ??
    (horizontal
      ? { x: -(Math.sign(dx) || 1), y: 0 }
      : { x: 0, y: -(Math.sign(dy) || 1) });

  const c1: Point = { x: a.x + srcT.x * bend, y: a.y + srcT.y * bend };
  const c2: Point = { x: b.x + tgtT.x * bend, y: b.y + tgtT.y * bend };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

/**
 * Straight line from `a` to `b`.
 */
export function straightPath(a: Point, b: Point): string {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

/**
 * Orthogonal (right-angle) path from `a` to `b`.
 *
 * Strategy: axis-aligned segments with a single elbow.  We pick the elbow
 * direction that matches the dominant movement axis of the anchor points so
 * the path always exits its source anchor in the same direction as the
 * bezier default would.
 *
 *   horizontal-first (|dx| ≥ |dy|):   a → (mid-x, a.y) → (mid-x, b.y) → b
 *   vertical-first   (|dy| > |dx|):   a → (a.x, mid-y) → (b.x, mid-y) → b
 */
export function orthogonalPath(a: Point, b: Point): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = (a.x + b.x) / 2;
    return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;
  }
  const midY = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
}

/**
 * @deprecated Use `catmullRomPath` for multi-waypoint curves.
 * Kept as a thin wrapper for any direct callers during transition.
 */
export function waypointCurvePath(a: Point, w: Point, b: Point): string {
  return catmullRomPath(a, [w], b);
}

/**
 * Catmull-Rom spline that passes THROUGH every point in:
 *   [src anchor]  →  waypoints[0]  →  …  →  waypoints[N-1]  →  [tgt anchor]
 *
 * Algorithm: Catmull-Rom → cubic Bézier conversion.
 * For each interior segment P[i] → P[i+1] the two cubic control points are:
 *
 *   CP1 = P[i]   + tangent(P[i])   / 3
 *   CP2 = P[i+1] - tangent(P[i+1]) / 3
 *
 * where the tangent at interior point P[k] is:
 *   T[k] = (P[k+1] - P[k-1]) * tension
 *
 * At the boundary endpoints the tangent points directly towards/from the
 * first/last interior neighbour (gives a natural open-ended curve).
 *
 * tension = 0.5 gives the classic centripetal Catmull-Rom feel.
 */
export function catmullRomPath(src: Point, waypoints: Point[], tgt: Point): string {
  // Full ordered point sequence.
  const pts: Point[] = [src, ...waypoints, tgt];
  const n = pts.length;

  // Need at least 2 points to draw anything.
  if (n < 2) return `M ${src.x} ${src.y}`;

  const tension = 0.5;

  // Compute tangents for all points.
  // Boundary tangents point directly to/from the adjacent point.
  const tx: number[] = new Array(n);
  const ty: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tx[i] = (pts[1].x - pts[0].x) * tension;
      ty[i] = (pts[1].y - pts[0].y) * tension;
    } else if (i === n - 1) {
      tx[i] = (pts[n - 1].x - pts[n - 2].x) * tension;
      ty[i] = (pts[n - 1].y - pts[n - 2].y) * tension;
    } else {
      tx[i] = (pts[i + 1].x - pts[i - 1].x) * tension;
      ty[i] = (pts[i + 1].y - pts[i - 1].y) * tension;
    }
  }

  // Build SVG path: M then one cubic Bézier segment per consecutive pair.
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const cp1x = p0.x + tx[i] / 3;
    const cp1y = p0.y + ty[i] / 3;
    const cp2x = p1.x - tx[i + 1] / 3;
    const cp2y = p1.y - ty[i + 1] / 3;
    d += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  return d;
}

function fmt(n: number): string {
  // Round to 2 dp to keep SVG compact.
  return String(Math.round(n * 100) / 100);
}

/**
 * Waypoint curve — chain the same `bezierPath` used for the initial line
 * between each pair of consecutive knots `[src, w0, w1, …, tgt]`.
 *
 * Each half looks exactly like the initial no-waypoint line (an axis-aware
 * cubic S-curve produced by `bezierPath`), just split at the waypoint(s).
 *
 * With 1 waypoint `W` between `src` and `tgt`:
 *   half 1: bezierPath(src, W)   — one cubic Bezier
 *   half 2: bezierPath(W, tgt)   — one cubic Bezier
 * → concatenated `M src.x src.y  C … W  C … tgt`.
 *
 * `bezierPath` picks a horizontal or vertical axis for each half based on
 * that half's own dx/dy — so if the waypoint sits directly above the
 * target (making the second half nearly vertical), the second half
 * naturally exits vertically. If the waypoint is collinear with src/tgt
 * on the axis, each half degenerates into a straight-looking cubic.
 *
 * • 0 waypoints  → `bezierPath(a, b)` directly (default S-curve).
 * • N waypoints  → N+1 chained cubic Béziers.
 *
 * The `srcRect`/`tgtRect` args are unused by this algorithm; the
 * signature is preserved for router compatibility.
 *
 * @param a          Source anchor point.
 * @param waypoints  Ordered user waypoints between `a` and `b`.
 * @param b          Target anchor point.
 */
export function waypointBezierPath(
  a: Point,
  waypoints: Point[],
  b: Point,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _srcRect: BBox,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _tgtRect: BBox,
  srcTangent?: Point,
  tgtTangent?: Point,
): string {
  if (waypoints.length === 0) return bezierPath(a, b, srcTangent, tgtTangent);
  return chainedBezierPath(a, waypoints, b, srcTangent, tgtTangent);
}

/**
 * Chain cubic Béziers between consecutive knots with C1 continuity at
 * every interior waypoint — so the two halves join smoothly, no kink.
 *
 * Model:
 *   knots  = [src, w0, w1, …, tgt]
 *   For each interior knot K[i], we compute a shared tangent direction
 *   T[i] = unit(K[i+1] − K[i-1])          (Catmull-Rom style)
 *   For endpoints (src, tgt), we reuse `bezierPath`'s axis-aware tangent
 *   direction so the FIRST and LAST halves still exit/enter the anchor
 *   just like the initial no-waypoint line.
 *
 * For each segment K[i] → K[i+1]:
 *   bend = clamp(|K[i+1] − K[i]| · 0.4, 30, 120)
 *   cp1  = K[i]   + T[i]   · bend
 *   cp2  = K[i+1] − T[i+1] · bend
 *
 * Because both halves that meet at an interior knot K use the SAME
 * tangent direction T[K] (one leaves along +T, next arrives along −(−T)),
 * their control points are colinear through K → C1 continuous → smooth.
 *
 * For the trivial 0-waypoint case, this reduces to exactly `bezierPath`.
 */
function chainedBezierPath(
  src: Point,
  waypoints: Point[],
  tgt: Point,
  srcTangent?: Point,
  tgtTangent?: Point,
): string {
  const knots: Point[] = [src, ...waypoints, tgt];
  const n = knots.length;

  // Per-knot outgoing tangent direction (unit vector).
  const tan: Point[] = new Array(n);

  // Interior tangents: unit(next - prev) — Catmull-Rom style. Guarantees
  // the two halves that meet at K share this direction → C1 continuity.
  for (let i = 1; i < n - 1; i++) {
    const prev = knots[i - 1];
    const next = knots[i + 1];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    tan[i] = { x: dx / len, y: dy / len };
  }

  // Endpoint tangents: prefer the router-supplied outward normals (which
  // encode the ACTUAL anchor side — top/bottom → vertical exit, left/
  // right → horizontal exit). Fall back to `bezierPath`'s axis-aware
  // heuristic when no side hint is available.
  tan[0] = srcTangent ?? anchorTangent(knots[0], knots[1]);
  tan[n - 1] = tgtTangent ?? anchorTangent(knots[n - 1], knots[n - 2]);
  // Note: the last tangent points FROM tgt TO its previous knot; we
  // want the outgoing direction leaving `tgt` backwards, so flip it so
  // that cp2 = tgt − T[n-1]·bend lands in front of tgt (toward prev).
  // Because we pass (tgt, prev) to anchorTangent it already returns the
  // direction pointing from tgt toward prev — that's what we want here
  // since the segment enters tgt from prev's side.

  let d = `M ${fmt(knots[0].x)} ${fmt(knots[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = knots[i];
    const p1 = knots[i + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const bend = Math.max(30, Math.min(120, Math.hypot(dx, dy) * 0.4));

    // cp1 leaves p0 along its outgoing tangent.
    // cp2 arrives at p1 along the INVERSE of p1's tangent (walk backward
    // from p1 toward the segment). For interior p1, tan[p1] points along
    // (next − prev), which is roughly toward `next`; walking backward
    // gives us `− tan[p1]`. For the endpoint case, tan[n-1] already
    // points from tgt toward prev, so we ADD instead of subtract.
    const cp1x = p0.x + tan[i].x * bend;
    const cp1y = p0.y + tan[i].y * bend;

    let cp2x: number;
    let cp2y: number;
    if (i + 1 === n - 1) {
      // Last segment: tan[n-1] points from tgt toward prev already.
      cp2x = p1.x + tan[i + 1].x * bend;
      cp2y = p1.y + tan[i + 1].y * bend;
    } else {
      // Interior knot: flip its tangent to walk backward into segment.
      cp2x = p1.x - tan[i + 1].x * bend;
      cp2y = p1.y - tan[i + 1].y * bend;
    }

    d += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(p1.x)} ${fmt(p1.y)}`;
  }
  return d;
}

/**
 * Direction used by `bezierPath` to leave anchor `a` heading toward `b`.
 * Returns a unit vector along either the ±x or ±y axis (whichever
 * dominates), matching `bezierPath`'s horizontal-vs-vertical split.
 */
function anchorTangent(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    return { x: Math.sign(dx) || 1, y: 0 };
  }
  return { x: 0, y: Math.sign(dy) || 1 };
}

/**
 * Public: single-quadratic-through-a-point helper.
 *
 * Kept for possible external use / tests. Not used by `waypointBezierPath`
 * any more — the new algorithm chains `bezierPath` between each pair of
 * consecutive knots (see `chainedBezierPath`).
 */
export function quadraticThroughPoint(p0: Point, m: Point, p2: Point): string {
  const cp: Point = {
    x: 2 * m.x - 0.5 * (p0.x + p2.x),
    y: 2 * m.y - 0.5 * (p0.y + p2.y),
  };
  return `M ${fmt(p0.x)} ${fmt(p0.y)} Q ${fmt(cp.x)} ${fmt(cp.y)}, ${fmt(p2.x)} ${fmt(p2.y)}`;
}

/**
 * Public: single cubic Bézier passing through m1 (t=1/3) and m2 (t=2/3).
 * Not used by `waypointBezierPath` any more; retained for reference/tests.
 */
export function cubicThroughTwoPoints(p0: Point, m1: Point, m2: Point, p3: Point): string {
  const ux = 27 * m1.x - 8 * p0.x -     p3.x;
  const uy = 27 * m1.y - 8 * p0.y -     p3.y;
  const vx = 27 * m2.x -     p0.x - 8 * p3.x;
  const vy = 27 * m2.y -     p0.y - 8 * p3.y;

  const cp1: Point = { x: (2 * ux - vx) / 18, y: (2 * uy - vy) / 18 };
  const cp2: Point = { x: (2 * vx - ux) / 18, y: (2 * vy - uy) / 18 };

  return (
    `M ${fmt(p0.x)} ${fmt(p0.y)}` +
    ` C ${fmt(cp1.x)} ${fmt(cp1.y)},` +
    ` ${fmt(cp2.x)} ${fmt(cp2.y)},` +
    ` ${fmt(p3.x)} ${fmt(p3.y)}`
  );
}

/**
 * Kidney-shaped self-loop anchored on the node's perimeter.
 * Used for edges whose source and target are the same node (`D --> D`).
 *
 * Behavior:
 *   • No waypoint → classic right-side kidney. Loop grows outward to
 *     accommodate the edge label (longer label → deeper loop) so the
 *     label doesn't overlap the node.
 *   • With waypoint → the loop's TWO endpoints slide around the node
 *     perimeter to sit on the side facing the waypoint, straddling the
 *     center-to-waypoint direction with a small perpendicular gap. The
 *     curve is a quadratic Bezier routed through the waypoint itself
 *     (Miro-style inverse-solve), so the dot follows the finger.
 *
 * @param labelWidth  Optional approximate width of the edge's label in
 *                    pixels. When non-zero, the default (no-waypoint)
 *                    loop expands outward so its "peak" sits beyond
 *                    the label's right edge with a small margin.
 */
export function selfLoopPath(rect: BBox, waypoint?: Point, labelWidth = 0): string {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const rightX = rect.x + rect.width;

  if (!waypoint) {
    // Default: kidney on the right side. `size` controls both the
    // vertical span of the two endpoints and how far the loop bulges
    // out to the right. Grow it if the label is wide.
    const baseSize = Math.max(20, Math.min(40, rect.height * 0.7));
    // The label sits at the horizontal peak of the kidney. To keep it
    // clear of the node, we want the peak-to-node distance to be at
    // least (labelWidth / 2 + margin). The current peak sits at
    // roughly `rightX + baseSize`, so bump size when the label demands.
    const labelMargin = 12;
    const requiredForLabel = labelWidth > 0 ? labelWidth / 2 + labelMargin : 0;
    const size = Math.max(baseSize, requiredForLabel);
    const start: Point = { x: rightX, y: cy - size * 0.25 };
    const end: Point = { x: rightX, y: cy + size * 0.25 };
    const outX = rightX + size;
    return `M ${start.x} ${start.y} C ${outX} ${cy - size}, ${outX} ${cy + size}, ${end.x} ${end.y}`;
  }

  // Waypoint present → derive endpoints from the direction (center → waypoint).
  const dx = waypoint.x - cx;
  const dy = waypoint.y - cy;
  const dlen = Math.hypot(dx, dy) || 1;
  const dirX = dx / dlen;
  const dirY = dy / dlen;

  // Ray from center in direction `dir` intersected with the bbox perimeter
  // gives the "peak" point on the side facing the waypoint.
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  // Solve for the smallest positive t such that (cx + t*dirX, cy + t*dirY)
  // hits the bbox: t = min(halfW/|dirX|, halfH/|dirY|).
  const tX = Math.abs(dirX) > 1e-6 ? halfW / Math.abs(dirX) : Infinity;
  const tY = Math.abs(dirY) > 1e-6 ? halfH / Math.abs(dirY) : Infinity;
  const t = Math.min(tX, tY);
  const peak: Point = { x: cx + dirX * t, y: cy + dirY * t };

  // Perpendicular unit vector (rotate `dir` by 90°).
  const perpX = -dirY;
  const perpY = dirX;
  // Gap between the two endpoints, proportional to the node size but
  // clamped so tiny nodes still get a visible loop and huge nodes don't
  // sprout comically wide anchors.
  const gap = Math.max(8, Math.min(24, Math.min(rect.width, rect.height) * 0.25));

  const rawStart: Point = { x: peak.x + perpX * gap, y: peak.y + perpY * gap };
  const rawEnd: Point = { x: peak.x - perpX * gap, y: peak.y - perpY * gap };

  // Snap each endpoint back onto the bbox perimeter — for pure-cardinal
  // directions the raw points already sit on it; for diagonals they need
  // clamping so they don't hover just outside the box.
  const start = clampToBBoxPerimeter(rect, rawStart);
  const end = clampToBBoxPerimeter(rect, rawEnd);

  // Route a quadratic through the exact waypoint so the drag handle
  // remains ON the curve.
  return quadraticThroughPoint(start, waypoint, end);
}

/**
 * Clamp a point that is already close to the bbox perimeter onto its
 * nearest side, without moving it further than necessary. Used by
 * `selfLoopPath` so diagonal-derived endpoints stay on the outline.
 */
function clampToBBoxPerimeter(rect: BBox, p: Point): Point {
  const x = Math.max(rect.x, Math.min(rect.x + rect.width, p.x));
  const y = Math.max(rect.y, Math.min(rect.y + rect.height, p.y));
  // Snap to whichever side is closest.
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
