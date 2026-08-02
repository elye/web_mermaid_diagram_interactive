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
import { useSelectionStore } from '@/stores/selectionStore';
import { useStyleStore } from '@/stores/styleStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useDiagramStore } from '@/stores/diagramStore';
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
          value={current.fill ?? '#ffffff'}
          onChange={(e) => applyProp({ fill: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Stroke color</span>
        <input
          type="color"
          aria-label="Stroke color"
          value={current.stroke ?? '#333333'}
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
          value={current.fontColor ?? '#000000'}
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

// ─── Panel switcher ───────────────────────────────────────────────────────────

export function PropertiesPanel() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useSelectionStore((s) => s.selectedEdgeIds);

  if (selectedNodeIds.size > 0) return <NodePropertiesPanel />;
  if (selectedEdgeIds.size > 0) return <EdgePropertiesPanel />;
  return null;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

const NODE_PRESETS = [
  { name: 'Success', style: { fill: '#dcfce7', stroke: '#16a34a', fontColor: '#14532d' } },
  { name: 'Warning', style: { fill: '#fef3c7', stroke: '#d97706', fontColor: '#78350f' } },
  { name: 'Error', style: { fill: '#fee2e2', stroke: '#dc2626', fontColor: '#7f1d1d' } },
  { name: 'Muted', style: { fill: '#f3f4f6', stroke: '#6b7280', fontColor: '#374151' } },
] as const;
