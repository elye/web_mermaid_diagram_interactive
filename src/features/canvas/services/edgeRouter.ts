/**
 * edgeRouter — back-compat barrel.
 *
 * The implementation was decomposed into a set of small modules; see:
 *   - `./routing/*`  — orchestration, anchors, bezier + self-loop paths,
 *                       endpoint inference.
 *   - `./svg/*`      — DOM primitives (transforms, bbox, path geometry).
 *   - `./viewbox`    — viewBox fitting.
 *
 * Consumers should import from `'./routing'` and `'./viewbox'` directly
 * for new code, but this file re-exports the historically public surface
 * so `useNodeDrag`, `DiagramCanvas`, and the existing tests keep working
 * without any churn.
 */
export { routeAllEdges, nodeRect, anchorOn, bezierPath, straightPath, orthogonalPath } from './routing';
export type { RouteOptions } from './routing';
export { expandViewBoxToFit } from './viewbox';
