/**
 * Public surface of the canvas services layer.
 *
 * ```
 *  ┌─────────────────────────────────────────────────────────────┐
 *  │  DiagramCanvas (React) / useNodeDrag                        │
 *  │             │                                               │
 *  │             ▼                                               │
 *  │  services/index.ts  ◀─ import from here ─▶                  │
 *  │             │                                               │
 *  │   ┌─────────┼──────────┬──────────────┬──────────────┐      │
 *  │   ▼         ▼          ▼              ▼              ▼      │
 *  │ renderEngine  svgManipulator  routing/*  viewbox  svg/*     │
 *  └─────────────────────────────────────────────────────────────┘
 * ```
 *
 * Sub-modules stay internal so we can reshape them without breaking
 * consumers. Prefer importing from this barrel unless you have a very
 * specific reason to reach into a sub-module.
 */
export { renderMermaid } from './renderEngine';
export {
  annotateInteractiveElements,
  extractNodes,
  extractEdges,
} from './svgManipulator';
export { routeAllEdges, nodeRect, anchorOn, bezierPath, selfLoopPath, nearestNodeId } from './routing';
export { expandViewBoxToFit } from './viewbox';
export { extractUserNodeId, extractEdgeEndpoints } from './edgeIds';
export { groupBBox, localBBox, fallbackBBox, parseTranslate, pathEndpoints, pathMidpoint } from './svg';
