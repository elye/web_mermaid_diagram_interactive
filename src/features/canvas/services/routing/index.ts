/**
 * Barrel for the edge-routing pipeline. Higher-level modules import from
 * this file rather than reaching into individual sub-modules.
 */
export { anchorOn, centerOf } from './anchors';
export { bezierPath, selfLoopPath } from './paths';
export { nearestNodeId } from './endpointInference';
export { routeAllEdges, nodeRect } from './routeEdges';
