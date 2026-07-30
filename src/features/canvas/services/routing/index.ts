/**
 * Barrel for the edge-routing pipeline. Higher-level modules import from
 * this file rather than reaching into individual sub-modules.
 */
export { anchorOn, anchorOnSide, snapToPerimeter, centerOf } from './anchors';
export { bezierPath, straightPath, orthogonalPath, waypointCurvePath, selfLoopPath } from './paths';
export { nearestNodeId } from './endpointInference';
export { routeAllEdges, nodeRect } from './routeEdges';
export type { RouteOptions } from './routeEdges';
