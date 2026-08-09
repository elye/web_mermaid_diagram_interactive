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
import { anchorOn, bezierPath } from '../services/routing';
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
        // Restore rect inline style overrides we added
        rect.style.removeProperty('fill');
        rect.style.removeProperty('stroke');
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
      // No collapsed clusters — inject expanded-state toggle buttons, then
      // refit all cluster boxes around their member nodes (handles the case
      // where the last collapsed cluster was just expanded and parent boxes
      // need to re-wrap the now-full-size children).
      injectToggleButtons(clusterEls, collapsedClusters, toggleClusterCollapse);
      resizeClusters(svgEl, source, collapsedClusters);
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

    // Step 5: resize collapsed cluster rects to node size
    const collapsedBBoxes = new Map<string, BBox>();

    for (const clusterId of collapsedClusters) {
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

    // Step 5b: inject toggle buttons NOW, after rect resize, so bboxes are correct.
    injectToggleButtons(clusterEls, collapsedClusters, toggleClusterCollapse);

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

    for (const bundle of bundledEdges) {
      const clusterBBox = collapsedBBoxes.get(bundle.clusterId);
      // The external endpoint may itself be a collapsed cluster (cluster-to-cluster
      // bundle) — look it up in collapsedBBoxes first, then fall back to the
      // visible-node bbox map.
      const extBBox =
        collapsedBBoxes.get(bundle.externalNodeId) ?? extNodeBBoxes.get(bundle.externalNodeId);
      if (!clusterBBox || !extBBox) continue;

      const clusterCenter = {
        x: clusterBBox.x + clusterBBox.width / 2,
        y: clusterBBox.y + clusterBBox.height / 2,
      };
      const extCenter = {
        x: extBBox.x + extBBox.width / 2,
        y: extBBox.y + extBBox.height / 2,
      };

      // Anchor using the same heuristic as routeAllEdges.
      // in:    external node  ->  cluster
      // out:   cluster  ->  external node
      // bidir: cluster <-> external node (cluster drawn as source)
      let srcAnchor: { x: number; y: number };
      let tgtAnchor: { x: number; y: number };
      if (bundle.direction === 'in') {
        srcAnchor = anchorOn(extBBox, clusterCenter);
        tgtAnchor = anchorOn(clusterBBox, extCenter);
      } else {
        srcAnchor = anchorOn(clusterBBox, extCenter);
        tgtAnchor = anchorOn(extBBox, clusterCenter);
      }

      const d = bezierPath(srcAnchor, tgtAnchor);

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
      if (bundle.direction === 'bidir' && markerEndId) {
        path.setAttribute('marker-start', `url(#${markerEndId})`);
      }
      overlayGroup.appendChild(path);

      const label = bundleLabel(bundle.count);
      if (label) {
        const midX = (srcAnchor.x + tgtAnchor.x) / 2;
        const midY = (srcAnchor.y + tgtAnchor.y) / 2;
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

    // Step 7: refit parent cluster boxes around the collapsed children.
    // After collapsing Inner to 120×40, Outer's rect must shrink to wrap the
    // small box instead of the expanded member nodes. We pass collapsedClusters
    // so resizeClusters skips the collapsed clusters themselves (their 120×40
    // rect is already set above) but DOES include their current bbox when
    // computing the parent's union.
    resizeClusters(svgEl, source, collapsedClusters);
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

  for (const bundle of bundledEdges) {
    const clusterBBox = collapsedBBoxes.get(bundle.clusterId);
    const extBBox = collapsedBBoxes.get(bundle.externalNodeId) ?? extNodeBBoxes.get(bundle.externalNodeId);
    if (!clusterBBox || !extBBox) continue;

    const clusterCenter = { x: clusterBBox.x + clusterBBox.width / 2, y: clusterBBox.y + clusterBBox.height / 2 };
    const extCenter = { x: extBBox.x + extBBox.width / 2, y: extBBox.y + extBBox.height / 2 };

    let srcAnchor: { x: number; y: number };
    let tgtAnchor: { x: number; y: number };
    if (bundle.direction === 'in') {
      srcAnchor = anchorOn(extBBox, clusterCenter);
      tgtAnchor = anchorOn(clusterBBox, extCenter);
    } else {
      srcAnchor = anchorOn(clusterBBox, extCenter);
      tgtAnchor = anchorOn(extBBox, clusterCenter);
    }

    const d = bezierPath(srcAnchor, tgtAnchor);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', `mf-bundle-edge mf-bundle-edge--${bundle.direction}`);
    path.setAttribute('data-mf-bundle-cluster', bundle.clusterId);
    path.setAttribute('data-mf-bundle-external', bundle.externalNodeId);
    path.setAttribute('data-mf-bundle-direction', bundle.direction);
    path.setAttribute('data-mf-bundle-count', String(bundle.count));
    if (markerEndId) path.setAttribute('marker-end', `url(#${markerEndId})`);
    if (bundle.direction === 'bidir' && markerEndId) path.setAttribute('marker-start', `url(#${markerEndId})`);
    overlayGroup.appendChild(path);

    const label = bundleLabel(bundle.count);
    if (label) {
      const midX = (srcAnchor.x + tgtAnchor.x) / 2;
      const midY = (srcAnchor.y + tgtAnchor.y) / 2;
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

  // Try the inner rect first (most nodes); fall back to polygon (diamond shapes).
  const rect = nodeG.querySelector<SVGRectElement>('rect');
  if (rect) {
    const w = Number(rect.getAttribute('width') ?? '0');
    const h = Number(rect.getAttribute('height') ?? '0');
    if (w > 0 && h > 0) {
      return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    }
  }
  const poly = nodeG.querySelector<SVGPolygonElement>('polygon');
  if (poly) {
    try {
      const bb = poly.getBBox();
      return { x: cx + bb.x, y: cy + bb.y, width: bb.width, height: bb.height };
    } catch {
      return null;
    }
  }
  return null;
}

function resolveMarkerId(svg: SVGSVGElement, baseName: string): string | null {
  return svg.querySelector<SVGMarkerElement>(`defs marker[id^="${baseName}"]`)?.id ?? null;
}

function injectToggleButtons(
  clusterEls: Map<string, SVGGElement>,
  collapsedClusters: ReadonlySet<string>,
  toggleClusterCollapse: (id: string) => void,
) {
  for (const [clusterId, clusterG] of clusterEls) {
    const rect = clusterG.querySelector<SVGRectElement>(':scope > rect');
    if (!rect) continue;

    const isCollapsed = collapsedClusters.has(clusterId);
    const btnSize = 16;
    // Compute button position in the cluster <g>'s LOCAL coordinate system.
    // The rect is centred at the <g>'s origin: x=-w/2, y=-h/2, w, h.
    const w = Number(rect.getAttribute('width') ?? 0);
    const h = Number(rect.getAttribute('height') ?? 0);
    let btnX: number;
    let btnY: number;

    if (isCollapsed) {
      // Right edge, vertically centred.
      btnX = w / 2 - btnSize - 2;
      btnY = -(btnSize / 2);
    } else {
      // Top-right corner.
      btnX = w / 2 - btnSize - 4;
      btnY = -h / 2 + 4;
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
      : `Collapse subgraph "${clusterId}"` ;
    btn.setAttribute('aria-label', btn.title);
    btn.textContent = isCollapsed ? '▶' : '▼';

    btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleClusterCollapse(clusterId);
    });

    fo.appendChild(btn);
    clusterG.appendChild(fo);
  }
}
