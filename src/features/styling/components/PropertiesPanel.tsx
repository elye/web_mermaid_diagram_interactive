/**
 * PropertiesPanel — appears when node(s) or edge(s) are selected and lets
 * the user tweak visual style properties. Writes to styleStore, which
 * DiagramCanvas applies as inline SVG styles.
 *
 * Node panel  : fill, stroke color, stroke width, font color, presets,
 *               reset-to-origin button.
 * Edge panel  : stroke color, stroke width, dash pattern, line style,
 *               reset-to-origin button.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSelectionStore } from '@/stores/selectionStore';
import { useStyleStore } from '@/stores/styleStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useDiagramStore } from '@/stores/diagramStore';
import { parseSubgraphMembership, collectAllNodeIds } from '@/features/canvas/services/cluster';
import type { StyleOverride, EdgeLineStyle } from '@/shared/types/diagram';

// ─── Node Properties ──────────────────────────────────────────────────────────

function NodePropertiesPanel() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const nodeStyles = useStyleStore((s) => s.nodeStyles);
  const setNodeStyle = useStyleStore((s) => s.setNodeStyle);
  const clearNodeStyle = useStyleStore((s) => s.clearNodeStyle);
  const commit = useHistoryStore((s) => s.commit);
  const commitCoalesced = useHistoryStore((s) => s.commitCoalesced);

  const firstId = Array.from(selectedNodeIds)[0];
  const current = nodeStyles[firstId] ?? {};

  // When no user override is stored yet, read the actual rendered SVG color
  // so the pickers reflect what the node currently looks like.
  const svgDefaults = readSvgNodeColors(firstId);

  const fillValue      = current.fill      ?? svgDefaults.fill;
  const strokeValue    = current.stroke    ?? svgDefaults.stroke;
  const fontColorValue = current.fontColor ?? svgDefaults.fontColor;

  // Groups a burst of edits (slider drag, rapid preset clicks, etc.) to the
  // same selected node(s) into a single undo step — see historyStore's
  // `commitCoalesced` doc comment.
  const historyKey = `node:${Array.from(selectedNodeIds).sort().join(',')}`;

  /** Apply a single-property patch to all selected nodes. */
  const applyProp = (patch: StyleOverride) => {
    commitCoalesced(historyKey);
    selectedNodeIds.forEach((id) => setNodeStyle(id, patch));
  };

  /** Fully remove all overrides — restores Mermaid's default appearance. */
  const resetAll = () => {
    commit();
    selectedNodeIds.forEach((id) => clearNodeStyle(id));
    setTimeout(() => setSvgDefaults(readSvgNodeColors(firstId)), 50);
  };

  return (
    <aside
      role="region"
      aria-label="Node properties"
      className="z-10 h-full w-56 flex-shrink-0 overflow-y-auto border-l border-border bg-surface p-3 text-sm shadow-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Node Properties</h2>
        <span className="text-xs text-muted">{selectedNodeIds.size} selected</span>
      </div>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Fill</span>
        <input
          type="color"
          aria-label="Fill color"
          value={fillValue}
          onChange={(e) => applyProp({ fill: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Stroke color</span>
        <input
          type="color"
          aria-label="Stroke color"
          value={strokeValue}
          onChange={(e) => applyProp({ stroke: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">
          Stroke width: {current.strokeWidth ?? 1}px
        </span>
        <input
          type="range"
          min={0}
          max={12}
          step={0.5}
          value={current.strokeWidth ?? 1}
          onChange={(e) => applyProp({ strokeWidth: Number(e.target.value) })}
          className="w-full"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Font color</span>
        <input
          type="color"
          aria-label="Font color"
          value={fontColorValue}
          onChange={(e) => applyProp({ fontColor: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      {/* Presets */}
      <div className="mb-3 flex flex-wrap gap-1">
        {NODE_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyProp(preset.style)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-alt"
            style={{ background: preset.style.fill, color: preset.style.fontColor }}
            title={preset.name}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {/* Reset to origin */}
      <button
        onClick={resetAll}
        className="w-full rounded border border-border px-2 py-1 text-xs text-muted hover:bg-surface-alt"
        title="Reset selected nodes to their original Mermaid style"
      >
        ↺ Reset to original
      </button>
    </aside>
  );
}

// ─── Edge Properties ──────────────────────────────────────────────────────────

const DASH_OPTIONS: { label: string; value: string }[] = [
  { label: 'Solid', value: '' },
  { label: 'Dashed', value: '8 4' },
  { label: 'Dotted', value: '2 4' },
  { label: 'Dash-dot', value: '8 4 2 4' },
];

const LINE_STYLE_OPTIONS: { label: string; value: EdgeLineStyle; title: string }[] = [
  { label: '〜', value: 'curve', title: 'Curve — smooth bezier, drag midpoint handle to reshape' },
  { label: '—', value: 'straight', title: 'Straight — direct line between anchor points' },
  { label: '⌐', value: 'orthogonal', title: 'Orthogonal — right-angle elbow routing' },
];

function EdgePropertiesPanel() {
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds);
  const edgeStyles = useStyleStore((s) => s.edgeStyles);
  const setEdgeStyle = useStyleStore((s) => s.setEdgeStyle);
  const clearEdgeStyle = useStyleStore((s) => s.clearEdgeStyle);
  const clearEdgeWaypoints = useDiagramStore((s) => s.clearEdgeWaypoints);
  const clearEdgeAnchorOverrides = useDiagramStore((s) => s.clearEdgeAnchorOverrides);
  const commit = useHistoryStore((s) => s.commit);
  const commitCoalesced = useHistoryStore((s) => s.commitCoalesced);

  const firstId = Array.from(selectedEdgeIds)[0];
  const current = edgeStyles[firstId] ?? {};
  // Groups a burst of edits to the same selected edge(s) into a single undo
  // step — see historyStore's `commitCoalesced` doc comment.
  const historyKey = `edge:${Array.from(selectedEdgeIds).sort().join(',')}`;

  /** Apply a single-property patch to all selected edges. */
  const applyProp = (patch: StyleOverride) => {
    commitCoalesced(historyKey);
    selectedEdgeIds.forEach((id) => setEdgeStyle(id, patch));
  };

  const setLineStyle = (style: EdgeLineStyle) => {
    commitCoalesced(historyKey);
    selectedEdgeIds.forEach((id) => {
      setEdgeStyle(id, { lineStyle: style });
      // Clear waypoints when switching away from curve.
      if (style !== 'curve') clearEdgeWaypoints(id);
    });
  };

  /** Fully remove all overrides — restores Mermaid's default appearance. */
  const resetAll = () => {
    commit();
    selectedEdgeIds.forEach((id) => {
      clearEdgeStyle(id);
      clearEdgeWaypoints(id);
      clearEdgeAnchorOverrides(id);
    });
  };

  return (
    <aside
      role="region"
      aria-label="Edge properties"
      className="z-10 h-full w-56 flex-shrink-0 overflow-y-auto border-l border-border bg-surface p-3 text-sm shadow-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Edge Properties</h2>
        <span className="text-xs text-muted">{selectedEdgeIds.size} selected</span>
      </div>

      {/* Line style */}
      <div className="mb-2">
        <span className="mb-1 block text-xs text-muted">Line style</span>
        <div className="flex gap-1">
          {LINE_STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLineStyle(opt.value)}
              title={opt.title}
              className={`flex-1 rounded border px-2 py-1 text-sm font-bold ${
                (current.lineStyle ?? 'curve') === opt.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border hover:bg-surface-alt'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {(current.lineStyle ?? 'curve') === 'curve' && (
          <p className="mt-1 text-xs text-muted">
            Drag the ● handle on the edge to reshape the curve.
          </p>
        )}
      </div>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Stroke color</span>
        <input
          type="color"
          aria-label="Edge stroke color"
          value={current.stroke ?? '#333333'}
          onChange={(e) => applyProp({ stroke: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">
          Stroke width: {current.strokeWidth ?? 2}px
        </span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={current.strokeWidth ?? 2}
          onChange={(e) => applyProp({ strokeWidth: Number(e.target.value) })}
          className="w-full"
        />
      </label>

      <div className="mb-2">
        <span className="mb-1 block text-xs text-muted">Dash pattern</span>
        <div className="flex flex-wrap gap-1">
          {DASH_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => applyProp({ dashArray: opt.value })}
              className={`rounded border px-2 py-1 text-xs ${
                (current.dashArray ?? '') === opt.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border hover:bg-surface-alt'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reset to origin */}
      <button
        onClick={resetAll}
        className="mt-1 w-full rounded border border-border px-2 py-1 text-xs text-muted hover:bg-surface-alt"
        title="Reset selected edges to their original Mermaid style"
      >
        ↺ Reset to original
      </button>
    </aside>
  );
}

// ─── Cluster Properties ──────────────────────────────────────────────────────────

/** Convert rgb(r, g, b) / rgba(…) / any CSS color to a #rrggbb hex string. */
export function cssColorToHex(css: string): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  } catch {
    return '#ffffff';
  }
}

/** Read the computed fill/stroke/fontColor of a node's shape from the live SVG.
 *  nodeId is the Mermaid user-facing id (e.g. "A"), NOT the DOM element id
 *  (e.g. "flowchart-A-0") — look up via data-node-id attribute. */
export function readSvgNodeColors(nodeId: string): { fill: string; stroke: string; fontColor: string } {
  const g = document.querySelector<SVGGElement>(`g[data-node-id="${CSS.escape(nodeId)}"]`);
  const shape = g?.querySelector('rect.basic, polygon, ellipse, path.basic') ?? g?.querySelector('rect');
  const text = g?.querySelector('text');
  if (!shape) return { fill: '#ffffff', stroke: '#333333', fontColor: '#000000' };
  const cs = getComputedStyle(shape);
  const tcs = text ? getComputedStyle(text) : null;
  return {
    fill: cssColorToHex(cs.fill || '#ffffff'),
    stroke: cssColorToHex(cs.stroke || '#333333'),
    fontColor: tcs ? cssColorToHex(tcs.fill || '#000000') : '#000000',
  };
}

/** Read the computed fill/stroke of a cluster's rect from the live SVG. */
export function readSvgClusterColors(clusterId: string): { fill: string; stroke: string } {
  const g = document.getElementById(clusterId);
  const rect = g?.querySelector('rect');
  if (!rect) return { fill: '#ffffff', stroke: '#999999' };
  const cs = getComputedStyle(rect);
  return {
    fill: cssColorToHex(cs.fill || '#ffffff'),
    stroke: cssColorToHex(cs.stroke || '#999999'),
  };
}

function ClusterPropertiesPanel() {
  const selectedClusterId = useSelectionStore((s) => s.selectedClusterId);
  if (!selectedClusterId) return null;

  return <ClusterPropertiesPanelInner key={selectedClusterId} clusterId={selectedClusterId} />;
}

function ClusterPropertiesPanelInner({ clusterId }: { clusterId: string }) {
  const clusterStyles = useStyleStore((s) => s.clusterStyles);
  const setClusterStyle = useStyleStore((s) => s.setClusterStyle);
  const clearClusterStyle = useStyleStore((s) => s.clearClusterStyle);
  const commit = useHistoryStore((s) => s.commit);
  const commitCoalesced = useHistoryStore((s) => s.commitCoalesced);

  // ── Collapse state ──
  const source = useDiagramStore((s) => s.source);
  const collapsedClusters = useDiagramStore((s) => s.collapsedClusters);
  const toggleClusterCollapse = useDiagramStore((s) => s.toggleClusterCollapse);
  const expandClusterAndDescendants = useDiagramStore((s) => s.expandClusterAndDescendants);
  const isCollapsed = collapsedClusters.has(clusterId);
  const memberCount = useMemo(() => {
    const membership = parseSubgraphMembership(source);
    return collectAllNodeIds(clusterId, membership).size;
  }, [source, clusterId]);

  const handleExpandClick = () => {
    if (isCollapsed) {
      const membership = parseSubgraphMembership(source);
      const directMembers = membership.get(clusterId) ?? new Set<string>();
      const hasNestedCollapsed = [...directMembers].some(
        (m) => membership.has(m) && collapsedClusters.has(m),
      );
      if (hasNestedCollapsed) {
        // Show the same dialog as the canvas toggle button.
        document.querySelectorAll('dialog.mf-expand-dialog').forEach((el) => el.remove());
        const dialog = document.createElement('dialog');
        dialog.className = 'mf-expand-dialog';
        dialog.innerHTML = `
          <p class="mf-expand-dialog__title">Expand subgraph</p>
          <p class="mf-expand-dialog__body">This subgraph contains nested collapsed subgraphs. How would you like to expand?</p>
          <div class="mf-expand-dialog__actions">
            <button class="mf-expand-dialog__btn" data-action="cancel">Cancel</button>
            <button class="mf-expand-dialog__btn" data-action="one">First level only</button>
            <button class="mf-expand-dialog__btn mf-expand-dialog__btn--primary" data-action="all">Expand all</button>
          </div>`;
        const close = () => { dialog.close(); dialog.remove(); };
        dialog.addEventListener('click', (ev) => {
          const action = (ev.target as HTMLElement).dataset.action;
          if (action === 'cancel') { close(); }
          else if (action === 'one') { close(); toggleClusterCollapse(clusterId); }
          else if (action === 'all') { close(); expandClusterAndDescendants(clusterId); }
          else {
            const rect = dialog.getBoundingClientRect();
            if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) close();
          }
        });
        document.body.appendChild(dialog);
        dialog.showModal();
        return;
      }
    }
    toggleClusterCollapse(clusterId);
  };

  const current = clusterStyles[clusterId] ?? {};
  const historyKey = `cluster:${clusterId}`;

  // Read actual SVG colors as defaults when no override is set yet.
  const [svgDefaults, setSvgDefaults] = useState(() => readSvgClusterColors(clusterId));
  useEffect(() => {
    setSvgDefaults(readSvgClusterColors(clusterId));
  }, [clusterId]);

  const fillValue = current.fill ?? svgDefaults.fill;
  const strokeValue = current.stroke ?? svgDefaults.stroke;

  const applyProp = (patch: StyleOverride) => {
    commitCoalesced(historyKey);
    setClusterStyle(clusterId, patch);
  };

  const resetAll = () => {
    commit();
    clearClusterStyle(clusterId);
    // Re-read SVG defaults after reset (Mermaid re-applies its own styles)
    setTimeout(() => setSvgDefaults(readSvgClusterColors(clusterId)), 50);
  };

  return (
    <aside
      role="region"
      aria-label="Cluster properties"
      className="z-10 h-full w-56 flex-shrink-0 overflow-y-auto border-l border-border bg-surface p-3 text-sm shadow-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Subgraph</h2>
        <span className="text-xs text-muted">{clusterId}</span>
      </div>

      {/* Collapse / Expand toggle — view-state only, not tracked by undo/redo. */}
      <button
        onClick={handleExpandClick}
        className={
          'mb-3 w-full rounded border px-2 py-1 text-xs ' +
          (isCollapsed
            ? 'border-accent bg-accent/10 text-accent hover:bg-accent/20'
            : 'border-border hover:bg-surface-alt')
        }
        title={
          isCollapsed
            ? `Expand "${clusterId}" and show its ${memberCount} member node${memberCount === 1 ? '' : 's'}`
            : `Collapse "${clusterId}" and hide its ${memberCount} member node${memberCount === 1 ? '' : 's'}`
        }
      >
        {isCollapsed
          ? `▶ Expand (${memberCount} node${memberCount === 1 ? '' : 's'})`
          : `▼ Collapse (${memberCount} node${memberCount === 1 ? '' : 's'})`}
      </button>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Fill</span>
        <input
          type="color"
          aria-label="Cluster fill color"
          value={fillValue}
          onChange={(e) => applyProp({ fill: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Stroke color</span>
        <input
          type="color"
          aria-label="Cluster stroke color"
          value={strokeValue}
          onChange={(e) => applyProp({ stroke: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">
          Stroke width: {current.strokeWidth ?? 2}px
        </span>
        <input
          type="range"
          min={0}
          max={12}
          step={0.5}
          value={current.strokeWidth ?? 2}
          onChange={(e) => applyProp({ strokeWidth: Number(e.target.value) })}
          className="w-full"
        />
      </label>

      {/* Presets */}
      <div className="mb-3 flex flex-wrap gap-1">
        {CLUSTER_PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyProp(preset.style)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-alt"
            style={{ background: preset.style.fill, color: preset.labelColor, borderColor: preset.style.stroke }}
            title={preset.name}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <button
        onClick={resetAll}
        className="w-full rounded border border-border px-2 py-1 text-xs text-muted hover:bg-surface-alt"
        title="Reset cluster to its original Mermaid style"
      >
        ↺ Reset to original
      </button>
    </aside>
  );
}

// ─── Panel switcher ───────────────────────────────────────────────────────────

export function PropertiesPanel() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds);
  const selectedClusterId = useSelectionStore((s) => s.selectedClusterId);

  if (selectedClusterId) return <ClusterPropertiesPanel />;
  if (selectedNodeIds.size > 0) return <NodePropertiesPanel key={Array.from(selectedNodeIds).sort().join(',')} />;
  if (selectedEdgeIds.size > 0) return <EdgePropertiesPanel key={Array.from(selectedEdgeIds).sort().join(',')} />;
  return null;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

const NODE_PRESETS = [
  { name: 'Success', style: { fill: '#dcfce7', stroke: '#16a34a', fontColor: '#14532d' } },
  { name: 'Warning', style: { fill: '#fef3c7', stroke: '#d97706', fontColor: '#78350f' } },
  { name: 'Error', style: { fill: '#fee2e2', stroke: '#dc2626', fontColor: '#7f1d1d' } },
  { name: 'Muted', style: { fill: '#f3f4f6', stroke: '#6b7280', fontColor: '#374151' } },
] as const;

const CLUSTER_PRESETS: { name: string; labelColor: string; style: StyleOverride }[] = [
  { name: 'Blue',    labelColor: '#e0e7ff', style: { fill: '#1e3a8a', stroke: '#3b82f6' } },
  { name: 'Green',   labelColor: '#dcfce7', style: { fill: '#15803d', stroke: '#16a34a' } },
  { name: 'Yellow',  labelColor: '#fef3c7', style: { fill: '#854d0e', stroke: '#d97706' } },
  { name: 'Red',     labelColor: '#fee2e2', style: { fill: '#7f1d1d', stroke: '#dc2626' } },
  { name: 'Purple',  labelColor: '#f3e8ff', style: { fill: '#581c87', stroke: '#9333ea' } },
  { name: 'Slate',   labelColor: '#f1f5f9', style: { fill: '#1e293b', stroke: '#64748b' } },
];
