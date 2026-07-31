/**
 * clusterResize — back-compat barrel.
 *
 * The implementation was decomposed into a set of small modules; see:
 *   - `./cluster/subgraphParser.ts`  — Mermaid source parsing (membership).
 *   - `./cluster/clusterElements.ts` — DOM readers for cluster `<g>`s and
 *                                       member node bboxes.
 *   - `./cluster/topoOrder.ts`       — leaf-first traversal so parent
 *                                       clusters see already-resized children.
 *   - `./cluster/resize.ts`          — bbox union + orchestration
 *                                       (`resizeClusters`).
 *
 * Consumers should import from `'./cluster'` directly for new code, but
 * this file re-exports the historically public surface so `DiagramCanvas`,
 * `useNodeDrag`, and the existing tests keep working without any churn.
 *
 * ## Why this module exists
 * Mermaid lays out subgraph clusters (the bounding boxes with labels) once
 * at render time. When the user drags a node, the cluster rect is not
 * automatically updated. This module recomputes each cluster's bounding box
 * from the **current** node positions and resizes the `<rect>` + `translate`
 * in the live SVG, working recursively from the deepest nested subgraph
 * outward so parent clusters always encompass already-resized children.
 *
 * ## SVG structure (Mermaid output)
 *
 * ```svg
 * <g class="clusters">
 *   <g class="cluster" id="flowchart-outerSub-42" transform="translate(cx,cy)">
 *     <rect x="-w/2" y="-h/2" width="w" height="h" />
 *     <g class="label"><text>outerSub</text></g>
 *   </g>
 * </g>
 * <g class="nodes">
 *   <g data-node-id="A" transform="translate(nx,ny)"> … </g>
 * </g>
 * ```
 *
 * Nodes are NOT DOM-children of their cluster — they are siblings in the
 * flat nodes group. Membership is determined by parsing the Mermaid source.
 *
 * ## Coordinate model
 * Every cluster `<g>` carries `transform="translate(cx, cy)"` where (cx, cy)
 * is the **centre** of the cluster.  The inner `<rect>` is pre-centred:
 *   rect.x = −width/2,  rect.y = −height/2
 *
 * To resize we:
 *   1. Compute the union bbox of all member nodes in SVG-root space.
 *   2. Add padding on all sides.
 *   3. Set rect attributes (x/y/width/height) relative to a new centre.
 *   4. Write the new `translate(cx, cy)` on the cluster `<g>`.
 *   5. Reposition the label at the top centre of the cluster.
 */

export { resizeClusters, parseSubgraphMembership } from './cluster';
