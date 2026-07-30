/**
 * Barrel for the edge-routing pipeline. Higher-level modules import from
 * this file rather than reaching into individual sub-modules.
 */
export { anchorOn, anchorOnSide, snapToPerimeter, centerOf } from './anchors';
export { bezierPath, straightPath, orthogonalPath } from './paths';
export { waypointBezierPath } from './bezierChain';
export { selfLoopPath } from './selfLoop';
export { nearestNodeId } from './endpointInference';
export { routeAllEdges, nodeRect } from './routeEdges';
export type { RouteOptions } from './routeEdges';
