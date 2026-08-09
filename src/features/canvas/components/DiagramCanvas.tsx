/**
 * DiagramCanvas — mounts the rendered SVG, applies viewport transform,
 * wires pan/zoom, node-drag, cluster-drag and edge-drag interactions, and
 * applies style overrides & position overrides on each render.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useUiStore } from '@/stores/uiStore';
import {
  DiagramTooltip,
  computeNodeConnections,
  computeEdgeTooltipInfo,
  type TooltipInfo,
} from './DiagramTooltip';
import { useMermaidRender } from '../hooks/useMermaidRender';
import { useCanvasInteraction } from '../hooks/useCanvasInteraction';
import { useNodeDrag } from '../hooks/useNodeDrag';
import { useClusterDrag } from '../hooks/useClusterDrag';
import { useClusterCollapse } from '../hooks/useClusterCollapse';
import { useEdgeDrag } from '../hooks/useEdgeDrag';
import { routeAllEdges, expandViewBoxToFit } from '../services/edgeRouter';
import { resizeClusters } from '../services/clusterResize';
import { extractClusterUserId } from '../services/cluster/clusterElements';
import { parseSubgraphMembership, collectAllNodeIds } from '../services/cluster';
import { computeCollapseState } from '../services/collapseUtils';
import { contrastColor, setImportantStyle } from '../services/svg/styleUtils';
import { cssEscape } from '../services/svg';
import { applyMarkerScaling, applyMarkerStartScaling } from '../services/markerScaling';
import { getConnectedHighlights } from '../services/graphTraversal';
import type { EdgeLineStyle } from '@/shared/types/diagram';

export function DiagramCanvas() {
  useMermaidRender();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  // Each node's natural (Mermaid-computed) transform, captured right after
  // the SVG is injected and before any position override is applied. See
  // the SVG-injection effect below for why this is needed.
  const naturalPositionsRef = useRef<Map<string, string>>(new Map());

  const svg = useDiagramStore((s) => s.svg);
  const source = useDiagramStore((s) => s.source);
  const positionOverrides = useDiagramStore((s) => s.positionOverrides);
  const edgeWaypoints = useDiagramStore((s) => s.edgeWaypoints);
  const edgeAnchorOverrides = useDiagramStore((s) => s.edgeAnchorOverrides);
  const edges = useDiagramStore((s) => s.edges);
  const collapsedClusters = useDiagramStore((s) => s.collapsedClusters);
  const nodeStyles = useStyleStore((s) => s.nodeStyles);
  const edgeStyles = useStyleStore((s) => s.edgeStyles);
  const clusterStyles = useStyleStore((s) => s.clusterStyles);
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds);
  const selectedClusterId = useSelectionStore((s) => s.selectedClusterId);
  const viewport = useUiStore((s) => s.viewport);
  const connectivityMode = useUiStore((s) => s.connectivityMode);
  const showTooltip = useUiStore((s) => s.showTooltip);

  // ── Tooltip state ──────────────────────────────────────────────────────────
  const [tooltipInfo, setTooltipInfo] = useState<TooltipInfo | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build Maps for the router (stable across re-renders when contents haven't changed).
  const lineStyleMap = useMemo(() => {
    const m = new Map<string, EdgeLineStyle>();
    Object.entries(edgeStyles).forEach(([id, s]) => {
      if (s.lineStyle) m.set(id, s.lineStyle);
    });
    return m;
  }, [edgeStyles]);

  const waypointMap = useMemo(() => {
    const m = new Map(Object.entries(edgeWaypoints));
    return m;
  }, [edgeWaypoints]);

  const anchorOverrideMap = useMemo(
    () => new Map(Object.entries(edgeAnchorOverrides)),
    [edgeAnchorOverrides],
  );

  // A stable string we can use as a dep for useEdgeDrag so handles
  // re-inject when selection, edge-styles, waypoints, or anchor overrides
  // change (e.g. after undo/redo).
  const edgeDragDeps = `${svg}|${[...selectedEdgeIds].join(',')}|${JSON.stringify(edgeStyles)}|${JSON.stringify(edgeAnchorOverrides)}|${JSON.stringify(edgeWaypoints)}`;

  const { onPointerDown } = useCanvasInteraction(containerRef);
  useNodeDrag(svgHostRef);
  useClusterDrag(svgHostRef, svg);
  useClusterCollapse(svgHostRef, svg);
  useEdgeDrag(svgHostRef, edgeDragDeps);

  // Inject SVG into DOM, then snapshot each node's natural (Mermaid-computed)
  // transform before any position overrides are applied. This snapshot is
  // what lets us restore a node's original spot below when an override is
  // removed entirely (e.g. undoing a node's very first move) — without it,
  // the node's transform attribute would just keep whatever value we last
  // wrote and never revert, even though the store correctly has no override.
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    host.innerHTML = svg;
    const naturalPositions = new Map<string, string>();
    host.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      const id = g.getAttribute('data-node-id');
      const transform = g.getAttribute('transform');
      if (id && transform) naturalPositions.set(id, transform);
    });
    naturalPositionsRef.current = naturalPositions;
  }, [svg]);

  // Apply per-node position overrides after each render, then re-run the
  // edge router so lines follow the overridden positions, then expand the
  // viewBox to fit. This is what makes moved nodes survive Mermaid re-renders
  // (which happen whenever the user types new source).
  useLayoutEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const svgEl = host.querySelector('svg') as SVGSVGElement | null;
    if (!svgEl) return;

    // Never clip a moved node.
    svgEl.style.overflow = 'visible';
    (svgEl.style as CSSStyleDeclaration).maxWidth = 'none';

    // For every node in the freshly rendered SVG: apply its override if one
    // exists, otherwise restore its natural (pre-override) position. Without
    // the "else" branch, undoing a node's only override left the DOM stuck
    // showing the last-overridden position forever, even though the store
    // correctly went back to having no override for that node.
    svgEl.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      const id = g.getAttribute('data-node-id');
      if (!id) return;
      const pos = positionOverrides[id];
      if (pos) {
        g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      } else {
        const natural = naturalPositionsRef.current.get(id);
        if (natural) g.setAttribute('transform', natural);
      }
    });

    routeAllEdges(svgEl, { lineStyles: lineStyleMap, waypoints: waypointMap, anchorOverrides: anchorOverrideMap });
    // Resize subgraph cluster rectangles after position overrides are applied.
    // Pass collapsedClusters so collapsed children are skipped (their 120×40 rect
    // is owned by useClusterCollapse) but still included in parent bbox unions.
    const { source: src, collapsedClusters: cc } = useDiagramStore.getState();
    resizeClusters(svgEl, src, cc);
    expandViewBoxToFit(svgEl);
  }, [positionOverrides, svg, lineStyleMap, waypointMap, anchorOverrideMap]);

  // Apply per-node/edge style overrides.
  //
  // We iterate ALL nodes and edges in the DOM, not just those with overrides,
  // so that when an override is removed (reset) the inline styles are explicitly
  // cleared back to '' — letting Mermaid's default styles take over immediately.
  //
  // Selection is intentionally NEVER expressed by overriding stroke color here
  // — doing so used to hide the user's own preset/custom stroke color (e.g.
  // applying "Error" to a selected node still looked like nothing happened,
  // because the accent color replaced the preset's red border). The selection
  // ring is drawn via the `.mf-node--selected` / `.mf-edge--selected` CSS
  // filter classes instead (see globals.css), which never touches `stroke`.
  //
  // Overrides are applied with `!important`: Mermaid's `classDef`/`class`
  // directive (very common in real-world diagrams) emits its own CSS rules
  // with `!important` (e.g. `.src>* { fill: ... !important; }`), which would
  // otherwise silently beat a plain inline style — the panel would show the
  // new color while the canvas kept rendering the classDef color. `!important`
  // inline styles beat `!important` stylesheet rules, so this makes overrides
  // win regardless of whether the node has a Mermaid class applied.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    // ── Nodes ──
    host.querySelectorAll<SVGGElement>('g[data-node-id]').forEach((g) => {
      const id = g.getAttribute('data-node-id')!;
      const style = nodeStyles[id] ?? {};
      const isSelected = selectedNodeIds.has(id);

      g.querySelectorAll<SVGElement>('rect, polygon, circle, ellipse, path').forEach((shape) => {
        setImportantStyle(shape, 'fill', style.fill ?? '');
        setImportantStyle(shape, 'stroke', style.stroke ?? '');
        // Selection bumps stroke width for extra visual weight, but never
        // touches color — honour the user's own strokeWidth if set.
        setImportantStyle(
          shape,
          'stroke-width',
          style.strokeWidth != null ? `${style.strokeWidth}px` : isSelected ? '2.5px' : '',
        );
      });

      // For text color: honour an explicit fontColor override first.
      // If only a fill is set (no explicit fontColor), auto-derive a
      // contrasting color so the label stays readable. Clear both when
      // there's no override so Mermaid's theme CSS wins.
      const autoTextColor =
        style.fontColor ? style.fontColor
        : style.fill     ? contrastColor(style.fill)
        : '';

      // Nodes use htmlLabels:true — label lives in foreignObject > div > span.nodeLabel.
      // Set color on the span directly (Mermaid's theme CSS targets it) and
      // on the wrapping div as a cascade fallback.
      const labelG = g.querySelector<SVGGElement>('g.label');
      const fo = labelG?.querySelector<SVGForeignObjectElement>('foreignObject');
      if (fo) {
        fo.querySelectorAll<HTMLElement>('span.nodeLabel, span[class*="nodeLabel"]').forEach((s) => {
          setImportantStyle(s, 'color', autoTextColor);
        });
        const wrapDiv = fo.querySelector<HTMLElement>('div');
        if (wrapDiv) setImportantStyle(wrapDiv, 'color', autoTextColor);
      }
      // SVG text fallback (non-htmlLabels diagrams).
      g.querySelectorAll<SVGTextElement>('text').forEach((t) => {
        setImportantStyle(t, 'fill', autoTextColor);
      });

      // Font size (independent of color).
      const anyText = g.querySelector<HTMLElement | SVGTextElement>('text, .nodeLabel');
      if (anyText) {
        setImportantStyle(anyText, 'font-size', style.fontSize != null ? `${style.fontSize}px` : '');
      }
    });

    // ── Edges ──
    host.querySelectorAll<SVGPathElement>('path[data-edge-id]').forEach((p) => {
      const id = p.getAttribute('data-edge-id')!;
      const style = edgeStyles[id] ?? {};
      const isSelected = selectedEdgeIds.has(id);

      setImportantStyle(p, 'stroke', style.stroke ?? '');
      const strokeWidth =
        style.strokeWidth != null ? style.strokeWidth : isSelected ? 3 : 2;
      setImportantStyle(p, 'stroke-width', `${strokeWidth}px`);
      setImportantStyle(p, 'stroke-dasharray', style.dashArray ?? '');

      // Scale arrow markers to match stroke width.
      const svgEl = host.querySelector('svg') as SVGSVGElement | null;
      if (svgEl) {
        applyMarkerScaling(p, strokeWidth, svgEl);
        applyMarkerStartScaling(p, strokeWidth, svgEl);
      }
    });

    // ── Clusters ──
    host.querySelectorAll<SVGGElement>('g.cluster').forEach((g) => {
      const id = extractClusterUserId(g.getAttribute('id') ?? '');
      if (!id) return;
      const style = clusterStyles[id] ?? {};

      const rect = g.querySelector('rect') as SVGRectElement | null;
      if (rect) {
        setImportantStyle(rect, 'fill', style.fill ?? '');
        setImportantStyle(rect, 'stroke', style.stroke ?? '');
        setImportantStyle(
          rect,
          'stroke-width',
          style.strokeWidth != null ? `${style.strokeWidth}px` : '',
        );
      }

      // ── Label: contrast text color ──
      // Mermaid uses htmlLabels:true so the title lives in a foreignObject:
      //   g.cluster-label > foreignObject > div > span.nodeLabel
      // We must set `color` on the span (and its parent div as fallback),
      // because Mermaid's theme CSS targets .nodeLabel with its own color
      // and !important is needed to win. The outer <div> color alone is
      // not enough because the span may have a more specific rule.
      const labelG = g.querySelector<SVGGElement>(
        ':scope > g.label, :scope > g.cluster-label',
      );
      if (labelG) {
        const fo = labelG.querySelector<SVGForeignObjectElement>('foreignObject');
        if (fo) {
          // Only apply a contrast color when there is an explicit fill override.
          // When there is no override (style.fill is empty) clear the inline color
          // so Mermaid's own theme CSS takes over again.
          const textColor = style.fill ? contrastColor(style.fill) : '';

          // Target span.nodeLabel directly — that's what Mermaid's CSS colours.
          // Also set it on the wrapping div so any other inline text inherits it.
          fo.querySelectorAll<HTMLElement>('span.nodeLabel, span[class*="nodeLabel"]').forEach((s) => {
            setImportantStyle(s, 'color', textColor);
          });
          const wrapDiv = fo.querySelector<HTMLElement>('div');
          if (wrapDiv) setImportantStyle(wrapDiv, 'color', textColor);
        }

        // SVG text-based labels (non-htmlLabels fallback).
        labelG.querySelectorAll<SVGTextElement>('text').forEach((t) => {
          setImportantStyle(t, 'fill', style.fill ? contrastColor(style.fill) : '');
        });
      }
    });
  }, [nodeStyles, edgeStyles, clusterStyles, svg, selectedNodeIds, selectedEdgeIds]);

  // Wire edge click → selectEdge. Mounted whenever the SVG changes so
  // newly rendered edges are always covered.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const handleEdgeClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      // Accept clicks on both the visible path and the wide hit-area sibling.
      // The hit path uses data-hit-edge-id; the real path uses data-edge-id.
      if (target?.closest('.mf-edge-handles')) return;
      let id: string | null = null;
      const hitPath = target?.closest('.mf-edge-hit') as SVGPathElement | null;
      if (hitPath) {
        id = hitPath.getAttribute('data-hit-edge-id');
      } else {
        const realPath = target?.closest('path[data-edge-id]') as SVGPathElement | null;
        id = realPath?.getAttribute('data-edge-id') ?? null;
      }
      if (!id) return;
      e.stopPropagation();
      useSelectionStore.getState().selectEdge(id, e.shiftKey);
    };
    host.addEventListener('click', handleEdgeClick);
    return () => host.removeEventListener('click', handleEdgeClick);
  }, [svg]);

  // Reflect selection in DOM, and compute + apply source/sink highlights.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    // ── Node selection ──
    host.querySelectorAll('.mf-node--selected').forEach((el) => el.classList.remove('mf-node--selected'));
    selectedNodeIds.forEach((id) => {
      const g = host.querySelector(`g[data-node-id="${cssEscape(id)}"]`);
      g?.classList.add('mf-node--selected');
    });

    // ── Edge selection ──
    host.querySelectorAll('.mf-edge--selected').forEach((el) => el.classList.remove('mf-edge--selected'));
    selectedEdgeIds.forEach((id) => {
      const p = host.querySelector(`path[data-edge-id="${cssEscape(id)}"]`);
      p?.classList.add('mf-edge--selected');
    });

    // ── Cluster selection ──
    host.querySelectorAll('.mf-cluster--selected').forEach((el) => el.classList.remove('mf-cluster--selected'));
    if (selectedClusterId) {
      const clusters = Array.from(host.querySelectorAll<SVGGElement>('g.cluster'));
      const cluster = clusters.find((g) =>
        extractClusterUserId(g.getAttribute('id') ?? '') === selectedClusterId
      );
      cluster?.classList.add('mf-cluster--selected');
    }

    // ── Source / sink highlights ──
    // Build the effective selected-node set. When a cluster is selected, expand
    // it to all its leaf member nodes so connectivity is still meaningful.
    let effectiveSelection: ReadonlySet<string> = selectedNodeIds;
    if (selectedClusterId) {
      const membership = parseSubgraphMembership(source);
      effectiveSelection = collectAllNodeIds(selectedClusterId, membership);
    }

    // Clear previous highlight classes.
    host.querySelectorAll('.mf-node--source').forEach((el) => el.classList.remove('mf-node--source'));
    host.querySelectorAll('.mf-node--sink').forEach((el) => el.classList.remove('mf-node--sink'));
    host.querySelectorAll('.mf-edge--connected').forEach((el) => el.classList.remove('mf-edge--connected'));

    const hasSelection =
      selectedNodeIds.size > 0 || selectedEdgeIds.size > 0 || selectedClusterId != null;

    // Toggle the canvas-level dim class.
    const canvas = containerRef.current;
    if (canvas) {
      canvas.classList.toggle('mf-canvas--has-selection', hasSelection);
    }

    if (hasSelection && connectivityMode !== 'none') {
      if (selectedEdgeIds.size > 0 && selectedNodeIds.size === 0 && !selectedClusterId) {
        // Edge-only selection: highlight just the two endpoint nodes of the
        // selected edge(s) as source/sink. Do NOT run the full neighbour
        // traversal — that would incorrectly highlight every other edge that
        // touches those nodes, not just the selected one.
        for (const edgeId of selectedEdgeIds) {
          const edgeMeta = edges.find((e) => e.id === edgeId);
          if (!edgeMeta) continue;
          // In edge-selection context, source endpoint = "source", target = "sink".
          // Respect the connectivity mode: only-sources hides the sink end, only-sinks hides the source end.
          // only-both: highlight both endpoints only if the edge is bidirectional.
          let anyEndpointHighlighted = false;
          const isBidir = edgeMeta.bidirectional ?? false;
          if (connectivityMode === 'only-both' && !isBidir) {
            // Not a bidirectional edge — show nothing in only-both mode.
          } else {
            if (edgeMeta.sourceId && connectivityMode !== 'only-sinks') {
              const g = host.querySelector(`g[data-node-id="${cssEscape(edgeMeta.sourceId)}"]`);
              if (g) { g.classList.add('mf-node--source'); anyEndpointHighlighted = true; }
            }
            if (edgeMeta.targetId && connectivityMode !== 'only-sources') {
              const g = host.querySelector(`g[data-node-id="${cssEscape(edgeMeta.targetId)}"]`);
              if (g) { g.classList.add('mf-node--sink'); anyEndpointHighlighted = true; }
            }
          }
          // Only keep the edge un-dimmed when at least one endpoint node is
          // actually highlighted — if neither endpoint exists in the rendered
          // SVG the edge itself should stay dimmed like all other unrelated edges.
          if (anyEndpointHighlighted) {
            const p = host.querySelector(`path[data-edge-id="${cssEscape(edgeId)}"]`);
            p?.classList.add('mf-edge--connected');
          }
        }
      } else {
        // Node / cluster selection: run full neighbour traversal.
        const { sourceNodeIds, sinkNodeIds, connectedEdgeIds, bidirectionalEdgeIds } = getConnectedHighlights(
          effectiveSelection,
          edges,
        );

        if (connectivityMode === 'only-both') {
          // only-both: show only nodes/edges connected via bidirectional (<-->) edges.
          // The mutual neighbour is simultaneously source AND sink, so apply both classes.
          bidirectionalEdgeIds.forEach((id) => {
            const p = host.querySelector(`path[data-edge-id="${cssEscape(id)}"]`);
            if (!p) return;
            p.classList.add('mf-edge--connected');
            const edgeSrc = p.getAttribute('data-edge-source');
            const edgeTgt = p.getAttribute('data-edge-target');
            // The neighbour is whichever end is NOT in the selection.
            const neighbourId = edgeSrc && !effectiveSelection.has(edgeSrc) ? edgeSrc
                              : edgeTgt && !effectiveSelection.has(edgeTgt) ? edgeTgt
                              : null;
            if (neighbourId) {
              const g = host.querySelector(`g[data-node-id="${cssEscape(neighbourId)}"]`);
              // Apply both source and sink glow to indicate mutual connection.
              g?.classList.add('mf-node--source');
              g?.classList.add('mf-node--sink');
            }
          });
        } else {
          // connectedEdgeIds covers edges to both sources and sinks; when the
          // mode restricts to one side we must also filter which edges to show.
          const shownSourceIds = connectivityMode !== 'only-sinks'   ? sourceNodeIds : new Set<string>();
          const shownSinkIds   = connectivityMode !== 'only-sources' ? sinkNodeIds   : new Set<string>();

          shownSourceIds.forEach((id) => {
            const g = host.querySelector(`g[data-node-id="${cssEscape(id)}"]`);
            g?.classList.add('mf-node--source');
          });
          shownSinkIds.forEach((id) => {
            const g = host.querySelector(`g[data-node-id="${cssEscape(id)}"]`);
            g?.classList.add('mf-node--sink');
          });

          // Only keep connected-edge highlights for the visible side(s).
          // An edge belongs to the "sources" side when its source node is a
          // highlighted source (i.e. upstream of the selection) — meaning the
          // edge runs from a source neighbour INTO the selection.
          // An edge belongs to the "sinks" side when its target node is a
          // highlighted sink (i.e. downstream of the selection).
          // We do NOT use effectiveSelection membership here: an edge whose
          // selected-end is in effectiveSelection but whose neighbour-end is
          // not shown should stay dimmed (e.g. B→C stays dimmed when only
          // sources are shown, even though B is selected).
          connectedEdgeIds.forEach((id) => {
            const p = host.querySelector(`path[data-edge-id="${cssEscape(id)}"]`);
            if (!p) return;
            const edgeSrc = p.getAttribute('data-edge-source');
            const edgeTgt = p.getAttribute('data-edge-target');
            const edgeMeta = edges.find((e) => e.id === id);
            // source-side edge: flows from a source neighbour into the selection.
            // For bidirectional edges the source neighbour may be at the tgt end
            // (edge runs "backwards"), so check both ends when bidir.
            const isSourceEdge = (edgeSrc ? shownSourceIds.has(edgeSrc) : false)
                               || (edgeMeta?.bidirectional && edgeTgt ? shownSourceIds.has(edgeTgt) : false);
            // sink-side edge: flows from the selection out to a sink neighbour.
            // For bidirectional edges (A <--> B) with B selected, the physical
            // source end (A) is also the sink neighbour, so check src too — but
            // only when the edge itself is bidirectional (avoids showing directed
            // edges that happen to originate from a bidir-marked sink neighbour).
            const isSinkEdge = (edgeTgt ? shownSinkIds.has(edgeTgt) : false)
                            || (edgeMeta?.bidirectional && edgeSrc ? shownSinkIds.has(edgeSrc) : false);
            // self-loop: both ends on a selected node — always keep visible
            const isSelfLoop = edgeSrc != null && edgeSrc === edgeTgt && effectiveSelection.has(edgeSrc);
            if (isSourceEdge || isSinkEdge || isSelfLoop) {
              p.classList.add('mf-edge--connected');
            }
          });
        }
      }
    }
    // ── Bundle edge connectivity highlight ────────────────────────────────
    // Bundle overlay paths (data-mf-bundle-cluster) carry no data-edge-source /
    // data-edge-target, so the main loop above never touches them.  We do a
    // second pass over ALL bundle paths and apply mf-edge--connected when the
    // bundle is relevant to the current selection and connectivity mode.
    //
    // Two cases are handled:
    //  (A) A collapsed cluster is selected → its bundle paths are the visible
    //      stand-ins for the hidden underlying edges.
    //  (B) A regular node is selected → bundle paths that connect the node to
    //      a collapsed cluster must be highlighted too.
    if (hasSelection && connectivityMode !== 'none') {
      // Recompute source/sink sets here so this pass always has the full picture
      // regardless of which branch (edge-only / node / cluster) ran above.
      const {
        sourceNodeIds: allSources,
        sinkNodeIds:   allSinks,
      } = getConnectedHighlights(effectiveSelection, edges);

      // Filter per mode.
      const showSources = connectivityMode !== 'only-sinks';
      const showSinks   = connectivityMode !== 'only-sources';
      const shownSources = showSources ? allSources : new Set<string>();
      const shownSinks   = showSinks   ? allSinks   : new Set<string>();

      // Build membership map once (needed to proxy cluster endpoints).
      const membership = parseSubgraphMembership(source);

      host.querySelectorAll<SVGPathElement>('path[data-mf-bundle-cluster]').forEach((bp) => {
        const clusterId = bp.getAttribute('data-mf-bundle-cluster') ?? '';
        const extId     = bp.getAttribute('data-mf-bundle-external') ?? '';
        const bundleDir = bp.getAttribute('data-mf-bundle-direction') ?? '';

        if (!collapsedClusters.has(clusterId)) return;

        const memberIds = collectAllNodeIds(clusterId, membership);

        // Is either endpoint directly part of the current selection?
        const extSelected     = effectiveSelection.has(extId);
        const clusterSelected = clusterId === selectedClusterId
                             || [...memberIds].some((m) => effectiveSelection.has(m));

        // Is either endpoint a highlighted source / sink?
        //   • external node as source/sink (standard case when ext is selected).
        //   • cluster-side: any member node in the source/sink sets.
        const extIsSource     = shownSources.has(extId);
        const extIsSink       = shownSinks.has(extId);
        const clusterIsSource = [...memberIds].some((m) => shownSources.has(m));
        const clusterIsSink   = [...memberIds].some((m) => shownSinks.has(m));

        let show = false;

        if (connectivityMode === 'only-both') {
          // only-both: highlight only truly bidirectional bundles where the
          // cluster ↔ external edge is represented by a bidir bundle.
          if (bundleDir === 'bidir') {
            // The bundle is bidir — check if the cluster/ext are in a bidir
            // relationship with the selection.
            show = clusterSelected || extSelected
                || clusterIsSource || clusterIsSink
                || extIsSource || extIsSink;
          }
        } else {
          // Directed / all modes.
          // 'out' = cluster → external (cluster is the upstream source).
          //   Show when: selected node is external (cluster feeds it — source side),
          //              OR cluster is selected and ext is a downstream sink.
          // 'in'  = external → cluster (external is the upstream source).
          //   Show when: selected node is external (it flows into cluster — sink side),
          //              OR cluster is selected and ext is an upstream source.
          // 'bidir': show when either the 'out' OR 'in' condition holds.

          const showOut = (extSelected  && clusterIsSource && showSources)
                       || (clusterSelected && extIsSink   && showSinks);
          const showIn  = (extSelected  && clusterIsSink  && showSinks)
                       || (clusterSelected && extIsSource  && showSources);

          if (bundleDir === 'out')        show = showOut;
          else if (bundleDir === 'in')    show = showIn;
          else if (bundleDir === 'bidir') show = showOut || showIn;
        }

        if (show) bp.classList.add('mf-edge--connected');
      });
    }
  }, [selectedNodeIds, selectedEdgeIds, selectedClusterId, svg, edges, source, connectivityMode, collapsedClusters, edgeWaypoints, edgeAnchorOverrides, positionOverrides]);

  // ── Tooltip hover wiring ───────────────────────────────────────────────────
  // We mount pointer-enter / pointer-move / pointer-leave listeners on the
  // SVG host div. A 600 ms delay avoids flashing the tooltip on quick passes.
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host || !showTooltip) return;

    const clearTimer = () => {
      if (tooltipTimerRef.current !== null) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      clearTimer();
      const target = e.target as Element | null;
      if (!target) { setTooltipInfo(null); return; }

      // ── Bundled summary edge (collapse overlay) ──
      const bundlePath = target.closest<SVGPathElement>('.mf-bundle-edge');

      // ── Collapsed cluster hover (rect or label inside a collapsed cluster) ──
      const clusterG = !bundlePath ? target.closest<SVGGElement>('g.cluster.mf-cluster--collapsed') : null;

      // ── Regular node ──
      const nodeG = (!bundlePath && !clusterG)
        ? target.closest<SVGGElement>('g[data-node-id]')
        : null;

      // ── Regular edge ──
      const edgePath = (!nodeG && !bundlePath && !clusterG)
        ? (target.closest<SVGPathElement>('path[data-edge-id]') ??
           target.closest<SVGPathElement>('.mf-edge-hit'))
        : null;

      if (!nodeG && !edgePath && !bundlePath && !clusterG) {
        setTooltipInfo(null);
        return;
      }

      const cx = e.clientX;
      const cy = e.clientY;

      tooltipTimerRef.current = setTimeout(() => {
        const { edges: currentEdges, nodes: currentNodes, source: currentSource, collapsedClusters: currentCollapsed } = useDiagramStore.getState();

        if (bundlePath) {
          // Bundled summary arrow tooltip.
          const clusterId = bundlePath.getAttribute('data-mf-bundle-cluster');
          const externalNodeId = bundlePath.getAttribute('data-mf-bundle-external');
          const direction = bundlePath.getAttribute('data-mf-bundle-direction') as 'in' | 'out' | 'bidir' | null;
          const countStr = bundlePath.getAttribute('data-mf-bundle-count');
          if (!clusterId || !externalNodeId || !direction) return;
          const extNode = currentNodes.find((n) => n.id === externalNodeId);
          setTooltipInfo({
            kind: 'bundled-edge',
            clusterId,
            externalNodeLabel: extNode?.label ?? externalNodeId,
            direction,
            count: countStr ? Number(countStr) : 1,
            x: cx,
            y: cy,
          });
        } else if (clusterG) {
          // Collapsed cluster tooltip.
          const rawId = clusterG.getAttribute('id') ?? '';
          // Extract user-facing cluster id from the raw DOM id.
          const clusterId = extractClusterUserId(rawId);
          if (!clusterId) return;

          const membership = parseSubgraphMembership(currentSource);
          const leafIds = collectAllNodeIds(clusterId, membership);
          const { bundledEdges } = computeCollapseState(currentCollapsed, membership, currentEdges);

          // For a collapsed cluster's tooltip we need to see BOTH:
          //   (a) bundles where THIS cluster is the source-side (b.clusterId === clusterId)
          //   (b) bundles where THIS cluster is the external endpoint of another
          //       collapsed cluster (b.externalNodeId === clusterId). Those record
          //       the direction from the OTHER cluster's viewpoint, so we invert:
          //       out↔in, bidir stays.
          const MAX = 20;
          const sourceNames: string[] = [];
          const sinkNames: string[] = [];
          const bidirNames: string[] = [];

          const invert = (d: 'in' | 'out' | 'bidir') => (d === 'in' ? 'out' : d === 'out' ? 'in' : 'bidir');

          for (const b of bundledEdges) {
            let selfSide: string;
            let otherSide: string;
            let dir: 'in' | 'out' | 'bidir';
            if (b.clusterId === clusterId) {
              selfSide = clusterId;
              otherSide = b.externalNodeId;
              dir = b.direction;
            } else if (b.externalNodeId === clusterId) {
              selfSide = clusterId;
              otherSide = b.clusterId;
              dir = invert(b.direction);
            } else {
              continue;
            }
            void selfSide;
            const extNode = currentNodes.find((n) => n.id === otherSide);
            const label = extNode?.label ?? otherSide;
            if (dir === 'in') sourceNames.push(label);
            else if (dir === 'out') sinkNames.push(label);
            else bidirNames.push(label);
          }
          setTooltipInfo({
            kind: 'collapsed-cluster',
            clusterId,
            memberCount: leafIds.size,
            sourceNames: sourceNames.slice(0, MAX),
            sourceOverflow: sourceNames.length > MAX,
            sinkNames: sinkNames.slice(0, MAX),
            sinkOverflow: sinkNames.length > MAX,
            bidirNames: bidirNames.slice(0, MAX),
            bidirOverflow: bidirNames.length > MAX,
            x: cx,
            y: cy,
          });
        } else if (nodeG) {
          const nodeId = nodeG.getAttribute('data-node-id');
          if (!nodeId) return;
          const nodeMeta = currentNodes.find((n) => n.id === nodeId);
          const connections = computeNodeConnections(nodeId, currentEdges, currentNodes);
          setTooltipInfo({
            kind: 'node',
            nodeId,
            label: nodeMeta?.label ?? nodeId,
            ...connections,
            x: cx,
            y: cy,
          });
        } else if (edgePath) {
          // Resolve the real edge id (hit paths use data-hit-edge-id)
          const edgeId =
            edgePath.getAttribute('data-edge-id') ??
            edgePath.getAttribute('data-hit-edge-id');
          if (!edgeId) return;
          const { label, sourceName, targetName, bidirectional } = computeEdgeTooltipInfo(
            edgeId,
            currentEdges,
            currentNodes,
            host,
          );
          setTooltipInfo({
            kind: 'edge',
            edgeId,
            label,
            sourceName,
            targetName,
            bidirectional,
            x: cx,
            y: cy,
          });
        }
      }, 600);
    };

    const handlePointerLeave = () => {
      clearTimer();
      setTooltipInfo(null);
    };

    host.addEventListener('pointermove', handlePointerMove);
    host.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      clearTimer();
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [svg, showTooltip]);

  // Hide tooltip whenever showTooltip is toggled off.
  useEffect(() => {
    if (!showTooltip) {
      if (tooltipTimerRef.current !== null) {
        clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
      setTooltipInfo(null);
    }
  }, [showTooltip]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Diagram canvas"
      onPointerDown={onPointerDown}
      className="mf-canvas relative h-full w-full overflow-hidden bg-surface"
      style={{ touchAction: 'none' }}
    >
      {/*
        The transform host is centered inside the viewport but must NOT clip
        its child — we intentionally omit overflow-hidden here so nodes that
        the user drags off the initial layout remain visible.
       */}
      <div
        ref={svgHostRef}
        className="absolute left-1/2 top-1/2 flex items-center justify-center"
        style={{
          transform: `translate(-50%, -50%) translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          transformOrigin: 'center center',
          transition: 'transform 60ms linear',
        }}
      />
      {tooltipInfo && <DiagramTooltip info={tooltipInfo} />}
    </div>
  );
}


