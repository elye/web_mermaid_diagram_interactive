/**
 * useClusterCollapse — applies the visual "collapse" effect to subgraph clusters.
 *
 * When a cluster is collapsed:
 *   1. The cluster rect is RESIZED to match a regular node (same width/height
 *      as the average node), centred at the cluster's original centre.
 *   2. All member nodes are hidden.
 *   3. Cross-cluster edges are replaced by properly-routed bezier summary
 *      arrows connecting the resized cluster box to each external node,
 *      with arrowheads and count labels (xN when N>1).
 *   4. A toggle button is injected into each cluster label.
 */

import { useEffect } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { parseSubgraphMembership } from '../services/cluster/subgraphParser';
import { collectClusterElements, clusterElementBBox } from '../services/cluster/clusterElements';
import { computeCollapseState, bundleLabel } from '../services/collapseUtils';
import { resizeClusters } from '../services/clusterResize';
import { cssEscape } from '../services/svg';
import { anchorOn, bezierPath, outwardNormal, centerOf } from '../services/routing';
import type { BBox } from '@/shared/types/diagram';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const BUNDLE_ATTR = 'data-mf-bundle';

export const COLLAPSED_W = 120;
export const COLLAPSED_H = 40;

export function useClusterCollapse(
  svgHostRef: React.RefObject<HTMLDivElement | null>,
  svg: string,
) {
  const source = useDiagramStore((s) => s.source);
  const collapsedClusters = useDiagramStore((s) => s.collapsedClusters);
  const toggleClusterCollapse = useDiagramStore((s) => s.toggleClusterCollapse);
  const edges = useDiagramStore((s) => s.edges);

  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const svgEl = host.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    // Step 1: clean up previous injections
    svgEl.querySelectorAll(`[${BUNDLE_ATTR}]`).forEach((el) => el.remove());
    svgEl.querySelectorAll('.mf-cluster-toggle').forEach((el) => el.remove());
    svgEl.querySelectorAll('.mf-cluster--collapsed').forEach((el) =>
      el.classList.remove('mf-cluster--collapsed'),
    );
    svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      g.style.display = '';
    });
    // Un-hide any cluster <g> elements that were hidden as nested collapsed clusters.
    svgEl.querySelectorAll<SVGGElement>('g.cluster').forEach((g) => {
      g.style.display = '';
    });
    svgEl.querySelectorAll<SVGElement>('path[data-edge-id], .mf-edge-hit, g.edgeLabel').forEach(
      (el) => { (el as unknown as HTMLElement).style.display = ''; },
    );
    // Restore cluster rects and labels resized in a previous pass.
    svgEl.querySelectorAll<SVGGElement>('g.cluster[data-mf-original-w]').forEach((g) => {
      const rect = g.querySelector<SVGRectElement>(':scope > rect');
      if (rect) {
        const ow = g.getAttribute('data-mf-original-w') ?? '';
        const oh = g.getAttribute('data-mf-original-h') ?? '';
        const orx = g.getAttribute('data-mf-original-rx') ?? '';
        const ory = g.getAttribute('data-mf-original-ry') ?? '';
        if (ow) {
          rect.setAttribute('width', ow);
          rect.setAttribute('x', String(-Number(ow) / 2));
        }
        if (oh) {
          rect.setAttribute('height', oh);
          rect.setAttribute('y', String(-Number(oh) / 2));
        }
        if (orx) rect.setAttribute('rx', orx); else rect.removeAttribute('rx');
        if (ory) rect.setAttribute('ry', ory); else rect.removeAttribute('ry');
        // Only remove stroke-width — fill and stroke were applied by DiagramCanvas
        // via setImportantStyle and must NOT be cleared here. Removing them
        // would wipe the user's color overrides until DiagramCanvas re-runs its
        // own effect (which only happens when its deps change, e.g. on click).
        rect.style.removeProperty('stroke-width');
      }
      // Restore cluster-label transform
      const labelG = g.querySelector<SVGGElement>('.cluster-label');
      if (labelG) {
        const origLabelT = g.getAttribute('data-mf-original-label-t');
        if (origLabelT !== null) labelG.setAttribute('transform', origLabelT);
        g.removeAttribute('data-mf-original-label-t');
        // Restore label foreignObject sizing
        const fo = labelG.querySelector<SVGForeignObjectElement>('foreignObject');
        if (fo) {
          const ofw = g.getAttribute('data-mf-original-label-w');
          const ofh = g.getAttribute('data-mf-original-label-h');
          const ofx = g.getAttribute('data-mf-original-label-x');
          const ofy = g.getAttribute('data-mf-original-label-y');
          if (ofw) fo.setAttribute('width', ofw);
          if (ofh) fo.setAttribute('height', ofh);
          if (ofx) fo.setAttribute('x', ofx);
          if (ofy && ofy !== 'none') fo.setAttribute('y', ofy); else fo.removeAttribute('y');
          g.removeAttribute('data-mf-original-label-w');
          g.removeAttribute('data-mf-original-label-h');
          g.removeAttribute('data-mf-original-label-x');
          g.removeAttribute('data-mf-original-label-y');
          // Reset div style overrides
          const div = fo.querySelector<HTMLDivElement>('div');
          if (div) {
            div.style.removeProperty('overflow');
            div.style.removeProperty('width');
            div.style.removeProperty('height');
            div.style.removeProperty('display');
            div.style.removeProperty('align-items');
            div.style.removeProperty('justify-content');
          }
        }
      }
      g.removeAttribute('data-mf-original-w');
      g.removeAttribute('data-mf-original-h');
      g.removeAttribute('data-mf-original-rx');
      g.removeAttribute('data-mf-original-ry');
    });

    const clusterEls = collectClusterElements(svgEl);

    if (collapsedClusters.size === 0) {
      // No collapsed clusters — refit all cluster boxes first so the rect
      // dimensions are final before we compute button positions.
      const membership0 = parseSubgraphMembership(source);
      resizeClusters(svgEl, source, collapsedClusters);
      injectToggleButtons(clusterEls, collapsedClusters, membership0, toggleClusterCollapse);
      return;
    }

    // Step 2: compute collapsed state
    const membership = parseSubgraphMembership(source);
    const { hiddenNodeIds, bundledEdges, hiddenEdgeIds } = computeCollapseState(
      collapsedClusters,
      membership,
      edges,
    );

    // Step 3: hide member nodes
    for (const nodeId of hiddenNodeIds) {
      const g = svgEl.querySelector<SVGGElement>(`g[data-node-id="${cssEscape(nodeId)}"]`);
      if (g) g.style.display = 'none';
    }

    // Step 4: hide original crossing/internal edges
    for (const edgeId of hiddenEdgeIds) {
      [
        `path[data-edge-id="${cssEscape(edgeId)}"]`,
        `.mf-edge-hit[data-hit-edge-id="${cssEscape(edgeId)}"]`,
        `g.edgeLabel[data-edge-id="${cssEscape(edgeId)}"]`,
      ].forEach((sel) => {
        svgEl.querySelectorAll<SVGElement>(sel).forEach((el) => { el.style.display = 'none'; });
      });
    }

    // Step 5: resize collapsed cluster rects to node size.
    // Only TOP-LEVEL collapsed clusters get a 120×40 box. A cluster is
    // top-level if none of its ancestors is also collapsed — nested collapsed
    // clusters are fully hidden inside their parent's collapsed box.
    const topLevelCollapsed = new Set<string>();
    for (const clusterId of collapsedClusters) {
      // Walk up the containment tree; if any ancestor is also collapsed,
      // this cluster is not top-level.
      let isNested = false;
      for (const [parentId, members] of membership) {
        if (parentId === clusterId) continue;
        if (collapsedClusters.has(parentId) && members.has(clusterId)) {
          isNested = true;
          break;
        }
      }
      if (!isNested) topLevelCollapsed.add(clusterId);
    }

    // Hide the <g> elements of nested collapsed clusters (they live inside
    // a parent that is already rendered as a collapsed 120×40 box).
    for (const clusterId of collapsedClusters) {
      if (!topLevelCollapsed.has(clusterId)) {
        const g = clusterEls.get(clusterId);
        if (g) g.style.display = 'none';
      }
    }

    const collapsedBBoxes = new Map<string, BBox>();

    for (const clusterId of topLevelCollapsed) {
      const g = clusterEls.get(clusterId);
      if (!g) continue;
      const originalBBox = clusterElementBBox(g);
      if (!originalBBox) continue;

      const cx = originalBBox.x + originalBBox.width / 2;
      const cy = originalBBox.y + originalBBox.height / 2;
      const newBBox: BBox = {
        x: cx - COLLAPSED_W / 2,
        y: cy - COLLAPSED_H / 2,
        width: COLLAPSED_W,
        height: COLLAPSED_H,
      };
      collapsedBBoxes.set(clusterId, newBBox);

      const rect = g.querySelector<SVGRectElement>(':scope > rect');
      if (rect) {
        g.setAttribute('data-mf-original-w', rect.getAttribute('width') ?? '');
        g.setAttribute('data-mf-original-h', rect.getAttribute('height') ?? '');
        g.setAttribute('data-mf-original-rx', rect.getAttribute('rx') ?? '');
        g.setAttribute('data-mf-original-ry', rect.getAttribute('ry') ?? '');
        rect.setAttribute('width', String(COLLAPSED_W));
        rect.setAttribute('height', String(COLLAPSED_H));
        rect.setAttribute('x', String(-COLLAPSED_W / 2));
        rect.setAttribute('y', String(-COLLAPSED_H / 2));
        // Make it look like a regular node: rounded corners + solid styling
        rect.setAttribute('rx', '4');
        rect.setAttribute('ry', '4');
        rect.style.setProperty('stroke-width', '1.5px');
      }

      // Reposition cluster label to be centred in the collapsed rect.
      const labelG = g.querySelector<SVGGElement>('.cluster-label');
      if (labelG) {
        g.setAttribute('data-mf-original-label-t', labelG.getAttribute('transform') ?? '');
        const fo = labelG.querySelector<SVGForeignObjectElement>('foreignObject');
        if (fo) {
          // Save original foreignObject sizing for restoration.
          g.setAttribute('data-mf-original-label-w', fo.getAttribute('width') ?? '');
          g.setAttribute('data-mf-original-label-h', fo.getAttribute('height') ?? '');
          g.setAttribute('data-mf-original-label-x', fo.getAttribute('x') ?? '');
          // Use 'none' sentinel when no original y attribute was present.
          g.setAttribute('data-mf-original-label-y', fo.getAttribute('y') ?? 'none');
          // Expand fo to cover the entire collapsed rect (-W/2, -H/2) to (W/2, H/2).
          fo.setAttribute('width', String(COLLAPSED_W));
          fo.setAttribute('height', String(COLLAPSED_H));
          fo.setAttribute('x', String(-COLLAPSED_W / 2));
          fo.setAttribute('y', String(-COLLAPSED_H / 2));
          // Override inline styles set by Mermaid so we can centre the text.
          const div = fo.querySelector<HTMLDivElement>('div');
          if (div) {
            div.style.setProperty('overflow', 'hidden', 'important');
            div.style.setProperty('width', '100%', 'important');
            div.style.setProperty('height', '100%', 'important');
            div.style.setProperty('display', 'flex', 'important');
            div.style.setProperty('align-items', 'center', 'important');
            div.style.setProperty('justify-content', 'center', 'important');
          }
        }
        // Centre label vertically: translate to put label in the middle of COLLAPSED_H.
        // The foreignObject y-offset is -COLLAPSED_H/2 (top of box), so transform(0, 0)
        // puts the label at the top. We want it centred, so no additional transform needed
        // — the div flex centering handles it.
        labelG.setAttribute('transform', 'translate(0, 0)');
      }

      g.classList.add('mf-cluster--collapsed');
    }

    // Step 5b: resize outer (non-collapsed) clusters around the new collapsed
    // child boxes, then inject toggle buttons so positions reflect final sizes.
    resizeClusters(svgEl, source, collapsedClusters);
    injectToggleButtons(clusterEls, collapsedClusters, membership, toggleClusterCollapse);

    // Step 6: draw properly-routed bundled bezier arrows
    if (bundledEdges.length === 0) return;

    // Collect visible external node bboxes in SVG root space.
    const extNodeBBoxes = new Map<string, BBox>();
    svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      if (g.style.display === 'none') return;
      const id = g.getAttribute('data-node-id');
      if (!id) return;
      const bbox = getNodeBBoxInSVGSpace(g, svgEl);
      if (bbox) extNodeBBoxes.set(id, bbox);
    });

    const overlayGroup = document.createElementNS(SVG_NS, 'g');
    overlayGroup.setAttribute(BUNDLE_ATTR, '1');
    overlayGroup.setAttribute('class', 'mf-bundle-overlays');

    const markerEndId = resolveMarkerId(svgEl, 'arrowhead');
    const markerStartId = ensureReversedMarker(svgEl, markerEndId);
    const tipOvershoot = markerTipOvershoot(svgEl, markerEndId);

    for (const bundle of bundledEdges) {
      const clusterBBox = collapsedBBoxes.get(bundle.clusterId);
      // The external endpoint may itself be a collapsed cluster (cluster-to-cluster
      // bundle) — look it up in collapsedBBoxes first, then fall back to the
      // visible-node bbox map.
      const extBBox =
        collapsedBBoxes.get(bundle.externalNodeId) ?? extNodeBBoxes.get(bundle.externalNodeId);
      if (!clusterBBox || !extBBox) continue;

      // Anchor using the same heuristic as routeAllEdges.
      // in:    external node  ->  cluster
      // out:   cluster  ->  external node
      // bidir: cluster <-> external node (cluster drawn as source)
      let srcBox: BBox;
      let tgtBox: BBox;
      if (bundle.direction === 'in') {
        srcBox = extBBox;
        tgtBox = clusterBBox;
      } else {
        srcBox = clusterBBox;
        tgtBox = extBBox;
      }
      const srcFacing = centerOf(tgtBox);
      const tgtFacing = centerOf(srcBox);
      const srcAnchor = anchorOn(srcBox, srcFacing);
      const tgtAnchor = anchorOn(tgtBox, tgtFacing);
      // Outward normals so the curve exits each box perpendicularly —
      // the same as routeSingleEdge in routeEdges.ts.
      const srcTangent = outwardNormal(srcBox, srcAnchor);
      const tgtTangent = outwardNormal(tgtBox, tgtAnchor);

      // Pull each arrow endpoint back by the marker tip overshoot so the
      // visual arrowhead tip lands exactly on the box edge, not inside it.
      // tgtTangent points outward FROM the target box — moving the endpoint in
      // that direction shortens the path and lets the tip reach the box edge.
      const tgtPulled = tipOvershoot > 0
        ? { x: tgtAnchor.x + tgtTangent.x * tipOvershoot,
            y: tgtAnchor.y + tgtTangent.y * tipOvershoot }
        : tgtAnchor;
      // For bidir, also pull the src endpoint back.
      const srcPulled = (tipOvershoot > 0 && bundle.direction === 'bidir')
        ? { x: srcAnchor.x + srcTangent.x * tipOvershoot,
            y: srcAnchor.y + srcTangent.y * tipOvershoot }
        : srcAnchor;

      const d = bezierPath(srcPulled, tgtPulled, srcTangent, tgtTangent);

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', `mf-bundle-edge mf-bundle-edge--${bundle.direction}`);
      path.setAttribute('data-mf-bundle-cluster', bundle.clusterId);
      path.setAttribute('data-mf-bundle-external', bundle.externalNodeId);
      path.setAttribute('data-mf-bundle-direction', bundle.direction);
      path.setAttribute('data-mf-bundle-count', String(bundle.count));

      if (markerEndId) {
        path.setAttribute('marker-end', `url(#${markerEndId})`);
      }
      if (bundle.direction === 'bidir' && markerStartId) {
        path.setAttribute('marker-start', `url(#${markerStartId})`);
      }
      overlayGroup.appendChild(path);

      const label = bundleLabel(bundle.count);
      if (label) {
        // Use the bezier midpoint (t=0.5) rather than the straight anchor
        // average, so the label sits on the curve regardless of its shape.
        const midX = bezierMidpoint(srcAnchor, tgtAnchor, srcTangent, tgtTangent).x;
        const midY = bezierMidpoint(srcAnchor, tgtAnchor, srcTangent, tgtTangent).y;
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', String(midX));
        text.setAttribute('y', String(midY - 6));
        text.setAttribute('class', 'mf-bundle-label');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('pointer-events', 'none');
        text.textContent = label;
        overlayGroup.appendChild(text);
      }
    }

    svgEl.appendChild(overlayGroup);
  }, [svg, source, collapsedClusters, edges, toggleClusterCollapse, svgHostRef]);
}

/**
 * Imperatively redraw the bundle edge overlay paths in `svgEl` using the
 * current cluster + node positions. Called by `useClusterDrag` on every
 * drag-move frame when dragging a collapsed cluster.
 *
 * Expects the caller to have already translated the cluster `<g>` so that
 * `clusterElementBBox` returns the new (dragged) position.
 */
export function rebuildBundleOverlays(svgEl: SVGSVGElement): void {
  // Remove old overlays.
  svgEl.querySelectorAll(`[${BUNDLE_ATTR}]`).forEach((el) => el.remove());

  const { collapsedClusters, source, edges } = useDiagramStore.getState();
  if (collapsedClusters.size === 0) return;

  const membership = parseSubgraphMembership(source);
  const { bundledEdges } = computeCollapseState(collapsedClusters, membership, edges);
  if (bundledEdges.length === 0) return;

  const clusterEls = collectClusterElements(svgEl);

  // Collect collapsed cluster bboxes from current DOM state.
  const collapsedBBoxes = new Map<string, BBox>();
  for (const clusterId of collapsedClusters) {
    const g = clusterEls.get(clusterId);
    if (!g) continue;
    const bbox = clusterElementBBox(g);
    if (bbox) collapsedBBoxes.set(clusterId, bbox);
  }

  // Collect visible external node bboxes.
  const extNodeBBoxes = new Map<string, BBox>();
  svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
    if (g.style.display === 'none') return;
    const id = g.getAttribute('data-node-id');
    if (!id) return;
    const bbox = getNodeBBoxInSVGSpace(g, svgEl);
    if (bbox) extNodeBBoxes.set(id, bbox);
  });

  const overlayGroup = document.createElementNS(SVG_NS, 'g');
  overlayGroup.setAttribute(BUNDLE_ATTR, '1');
  overlayGroup.setAttribute('class', 'mf-bundle-overlays');

  const markerEndId = resolveMarkerId(svgEl, 'arrowhead');
  const markerStartId = ensureReversedMarker(svgEl, markerEndId);
  const tipOvershoot = markerTipOvershoot(svgEl, markerEndId);

  for (const bundle of bundledEdges) {
    const clusterBBox = collapsedBBoxes.get(bundle.clusterId);
    const extBBox = collapsedBBoxes.get(bundle.externalNodeId) ?? extNodeBBoxes.get(bundle.externalNodeId);
    if (!clusterBBox || !extBBox) continue;

    let srcBox: BBox;
    let tgtBox: BBox;
    if (bundle.direction === 'in') {
      srcBox = extBBox;
      tgtBox = clusterBBox;
    } else {
      srcBox = clusterBBox;
      tgtBox = extBBox;
    }
    const srcAnchor = anchorOn(srcBox, centerOf(tgtBox));
    const tgtAnchor = anchorOn(tgtBox, centerOf(srcBox));
    const srcTangent = outwardNormal(srcBox, srcAnchor);
    const tgtTangent = outwardNormal(tgtBox, tgtAnchor);

    const tgtPulled = tipOvershoot > 0
      ? { x: tgtAnchor.x + tgtTangent.x * tipOvershoot,
          y: tgtAnchor.y + tgtTangent.y * tipOvershoot }
      : tgtAnchor;
    const srcPulled = (tipOvershoot > 0 && bundle.direction === 'bidir')
      ? { x: srcAnchor.x + srcTangent.x * tipOvershoot,
          y: srcAnchor.y + srcTangent.y * tipOvershoot }
      : srcAnchor;

    const d = bezierPath(srcPulled, tgtPulled, srcTangent, tgtTangent);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `mf-bundle-edge mf-bundle-edge--${bundle.direction}`);
    path.setAttribute('data-mf-bundle-cluster', bundle.clusterId);
    path.setAttribute('data-mf-bundle-external', bundle.externalNodeId);
    path.setAttribute('data-mf-bundle-direction', bundle.direction);
    path.setAttribute('data-mf-bundle-count', String(bundle.count));
    if (markerEndId) path.setAttribute('marker-end', `url(#${markerEndId})`);
    if (bundle.direction === 'bidir' && markerStartId) path.setAttribute('marker-start', `url(#${markerStartId})`);
    overlayGroup.appendChild(path);

    const label = bundleLabel(bundle.count);
    if (label) {
      const mid = bezierMidpoint(srcAnchor, tgtAnchor, srcTangent, tgtTangent);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(mid.x));
      text.setAttribute('y', String(mid.y - 6));
      text.setAttribute('class', 'mf-bundle-label');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('pointer-events', 'none');
      text.textContent = label;
      overlayGroup.appendChild(text);
    }
  }

  svgEl.appendChild(overlayGroup);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Evaluate the same cubic Bézier that `bezierPath` produces at t = 0.5.
 *
 * Matches the control-arm computation from `paths.ts` so the returned
 * point sits exactly on the rendered curve — used to place count labels.
 */
function bezierMidpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
  srcTangent: { x: number; y: number },
  tgtTangent: { x: number; y: number },
): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Mirrors bendFor() from paths/pathFormat.ts: clamp control-arm to [40, 200]
  // and scale it to 40% of the distance.
  const bend = Math.max(40, Math.min(200, dist * 0.4));
  const c1 = { x: a.x + srcTangent.x * bend, y: a.y + srcTangent.y * bend };
  const c2 = { x: b.x + tgtTangent.x * bend, y: b.y + tgtTangent.y * bend };
  // De Casteljau at t = 0.5
  const t = 0.5;
  const mt = 1 - t;
  return {
    x: mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x,
    y: mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y,
  };
}

/**
 * Return the bounding box of a `g[data-node-id]` in SVG root coordinate space.
 *
 * We derive it from the group's `transform="translate(cx,cy)"` + the inner rect's
 * dimensions, exactly like `clusterElementBBox` does for clusters. This avoids
 * getBBox()+getCTM() which is unreliable when the SVG is inside a CSS-transformed
 * container (the canvas pan/zoom div).
 */
function getNodeBBoxInSVGSpace(nodeG: SVGGElement, _svgEl: SVGSVGElement): BBox | null {
  const m = nodeG.getAttribute('transform') ?? '';
  const match = /translate\(\s*([+-]?\d*\.?\d+)\s*,\s*([+-]?\d*\.?\d+)\s*\)/.exec(m);
  if (!match) return null;
  const cx = Number(match[1]);
  const cy = Number(match[2]);

  // Try the inner rect first (most nodes).
  // Read rect.x / rect.y directly — do NOT assume the rect is centred at (cx,cy).
  const rect = nodeG.querySelector<SVGRectElement>('rect');
  if (rect) {
    const w = Number(rect.getAttribute('width') ?? '0');
    const h = Number(rect.getAttribute('height') ?? '0');
    if (w > 0 && h > 0) {
      const rx = Number(rect.getAttribute('x') ?? String(-w / 2));
      const ry = Number(rect.getAttribute('y') ?? String(-h / 2));
      return { x: cx + rx, y: cy + ry, width: w, height: h };
    }
  }

  // For non-rect shapes (diamond/polygon, etc.) use the node <g>'s own getBBox()
  // which correctly accounts for all child element transforms. The bbox is in
  // the node's LOCAL coordinate space (centred at cx,cy).
  try {
    const bb = nodeG.getBBox();
    return { x: cx + bb.x, y: cy + bb.y, width: bb.width, height: bb.height };
  } catch {
    return null;
  }
}

function resolveMarkerId(svg: SVGSVGElement, baseName: string): string | null {
  // Mermaid may place markers inside a <g> rather than <defs>, so query ALL
  // marker elements rather than only those under defs.
  const byName = svg.querySelector<SVGMarkerElement>(`marker[id*="${baseName}"]`);
  if (byName) return byName.id;
  // Fall back to the Mermaid "pointEnd" marker (flowchart-pointEnd).
  const mermaidEnd =
    svg.querySelector<SVGMarkerElement>('marker[id*="pointEnd"]') ??
    svg.querySelector<SVGMarkerElement>('marker[id$="End"]');
  return mermaidEnd?.id ?? null;
}

/**
 * Return the id of a reversed copy of the given marker, suitable for use
 * with `marker-start` on bidir edges. With `orient="auto"`, a marker-start
 * arrowhead points AWAY from the source box (wrong for a bidir arrow that
 * should show an incoming arrowhead). By cloning the marker with
 * `orient="auto-start-reverse"` the browser flips it 180° so the tip points
 * back INTO the source box as expected.
 *
 * The cloned marker is re-used on subsequent calls (idempotent).
 */
function ensureReversedMarker(svg: SVGSVGElement, markerId: string | null): string | null {
  if (!markerId) return null;
  const id = markerId.replace(/^url\(#/, '').replace(/\)$/, '');
  const reversedId = `${id}--rev`;
  if (svg.getElementById(reversedId)) return reversedId;

  const original = svg.getElementById(id) as SVGMarkerElement | null;
  if (!original) return null;

  const clone = original.cloneNode(true) as SVGMarkerElement;
  clone.id = reversedId;
  clone.setAttribute('orient', 'auto-start-reverse');
  // Insert into the same container as the original marker.
  original.parentNode?.insertBefore(clone, original.nextSibling);
  return reversedId;
}

/**
 * Compute how many SVG user-space units the tip of the arrowhead protrudes
 * beyond the path endpoint, so callers can pull the endpoint back by that
 * amount and have the visual tip land exactly on the target box edge.
 *
 * For a marker with viewBox="0 0 vbW vbH", refX, and markerWidth (in
 * userSpaceOnUse units), the tip is at the right edge of the viewBox (vbW),
 * and refX is aligned with the path endpoint. The overshoot in SVG units is:
 *   (vbW - refX) * (markerWidth / vbW)
 */
function markerTipOvershoot(svg: SVGSVGElement, markerId: string | null): number {
  if (!markerId) return 0;
  const id = markerId.replace(/^url\(#/, '').replace(/\)$/, '');
  const marker = svg.getElementById(id) as SVGMarkerElement | null;
  if (!marker) return 0;
  const vb = marker.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const refX = Number(marker.getAttribute('refX') ?? 0);
  const mw = Number(marker.getAttribute('markerWidth') ?? 0);
  if (!vb || vb.length < 4 || vb[2] === 0) return 0;
  const vbW = vb[2];
  return (vbW - refX) * (mw / vbW);
}

function injectToggleButtons(
  clusterEls: Map<string, SVGGElement>,
  collapsedClusters: ReadonlySet<string>,
  membership: Map<string, Set<string>>,
  toggleClusterCollapse: (id: string) => void,
) {
  for (const [clusterId, clusterG] of clusterEls) {
    const rect = clusterG.querySelector<SVGRectElement>(':scope > rect');
    if (!rect) continue;

    const isCollapsed = collapsedClusters.has(clusterId);
    const btnSize = 16;
    // Read the rect's actual x/y/width/height from DOM attributes so the
    // button position is correct even if the rect is not perfectly centred
    // at the <g>'s origin (e.g. after resizeClusters rewrites the transform).
    const rx = Number(rect.getAttribute('x') ?? 0);
    const ry = Number(rect.getAttribute('y') ?? 0);
    const rw = Number(rect.getAttribute('width') ?? 0);
    const rh = Number(rect.getAttribute('height') ?? 0);
    let btnX: number;
    let btnY: number;

    if (isCollapsed) {
      // Right edge, vertically centred.
      btnX = rx + rw - btnSize - 2;
      btnY = ry + rh / 2 - btnSize / 2;
    } else {
      // Top-right corner.
      btnX = rx + rw - btnSize - 4;
      btnY = ry + 4;
    }

    const fo = document.createElementNS(SVG_NS, 'foreignObject');
    fo.setAttribute('x', String(btnX));
    fo.setAttribute('y', String(btnY));
    fo.setAttribute('width', String(btnSize));
    fo.setAttribute('height', String(btnSize));
    fo.setAttribute('class', 'mf-cluster-toggle');
    fo.setAttribute('data-cluster-id', clusterId);

    const btn = document.createElement('button');
    btn.className = isCollapsed
      ? 'mf-cluster-toggle__btn mf-cluster-toggle__btn--collapsed'
      : 'mf-cluster-toggle__btn';
    btn.title = isCollapsed
      ? `Expand subgraph "${clusterId}"`
      : `Collapse subgraph "${clusterId}"`;
    btn.setAttribute('aria-label', btn.title);
    btn.textContent = isCollapsed ? '▶' : '▼';

    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (isCollapsed) {
        // Check whether any direct-child sub-clusters are also collapsed.
        // A direct child is a member of this cluster that is itself a subgraph.
        const directMembers = membership.get(clusterId) ?? new Set<string>();
        const hasNestedCollapsed = [...directMembers].some(
          (m) => membership.has(m) && collapsedClusters.has(m),
        );

        if (hasNestedCollapsed) {
          // Show a choice popover near the button.
          showExpandPopover(btn, clusterId, toggleClusterCollapse);
          return;
        }
      }

      toggleClusterCollapse(clusterId);
    });

    fo.appendChild(btn);
    clusterG.appendChild(fo);
  }
}

/**
 * Show a modal dialog asking whether to expand one level or all levels.
 */
function showExpandPopover(
  _anchorEl: HTMLElement,
  clusterId: string,
  toggleClusterCollapse: (id: string) => void,
): void {
  const { expandClusterAndDescendants } = useDiagramStore.getState();

  const dialog = document.createElement('dialog');
  dialog.className = 'mf-expand-dialog';

  const title = document.createElement('p');
  title.className = 'mf-expand-dialog__title';
  title.textContent = 'Expand subgraph';
  dialog.appendChild(title);

  const body = document.createElement('p');
  body.className = 'mf-expand-dialog__body';
  body.textContent = 'This subgraph contains nested collapsed subgraphs. How would you like to expand?';
  dialog.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'mf-expand-dialog__actions';

  const close = () => { dialog.close(); dialog.remove(); };

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mf-expand-dialog__btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);
  actions.appendChild(cancelBtn);

  const oneLevelBtn = document.createElement('button');
  oneLevelBtn.className = 'mf-expand-dialog__btn';
  oneLevelBtn.textContent = 'First level only';
  oneLevelBtn.addEventListener('click', () => { close(); toggleClusterCollapse(clusterId); });
  actions.appendChild(oneLevelBtn);

  const allBtn = document.createElement('button');
  allBtn.className = 'mf-expand-dialog__btn mf-expand-dialog__btn--primary';
  allBtn.textContent = 'Expand all';
  allBtn.addEventListener('click', () => { close(); expandClusterAndDescendants(clusterId); });
  actions.appendChild(allBtn);

  dialog.appendChild(actions);
  document.body.appendChild(dialog);
  dialog.showModal();

  // Clicking the backdrop (outside the dialog box) cancels.
  dialog.addEventListener('click', (ev) => {
    const rect = dialog.getBoundingClientRect();
    if (
      ev.clientX < rect.left || ev.clientX > rect.right ||
      ev.clientY < rect.top  || ev.clientY > rect.bottom
    ) {
      close();
    }
  });
}
