/**
 * PropertiesPanel — appears when node(s) are selected and lets the user
 * tweak fill / stroke / stroke width. Writes to styleStore, which the
 * DiagramCanvas applies as inline SVG styles.
 */
import { useSelectionStore } from '@/stores/selectionStore';
import { useStyleStore } from '@/stores/styleStore';
import { useHistoryStore } from '@/stores/historyStore';

export function PropertiesPanel() {
  const selectedNodeIds = useSelectionStore((s) => s.selectedNodeIds);
  const nodeStyles = useStyleStore((s) => s.nodeStyles);
  const setNodeStyle = useStyleStore((s) => s.setNodeStyle);
  const commit = useHistoryStore((s) => s.commit);

  if (selectedNodeIds.size === 0) return null;
  const firstId = Array.from(selectedNodeIds)[0];
  const current = nodeStyles[firstId] ?? {};

  const applyAll = (patch: Parameters<typeof setNodeStyle>[1]) => {
    commit();
    selectedNodeIds.forEach((id) => setNodeStyle(id, patch));
  };

  return (
    <aside
      role="region"
      aria-label="Element properties"
      className="absolute right-3 top-3 z-10 w-56 rounded-md border border-border bg-surface p-3 text-sm shadow-md"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Properties</h2>
        <span className="text-xs text-muted">{selectedNodeIds.size} selected</span>
      </div>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Fill</span>
        <input
          type="color"
          aria-label="Fill color"
          value={current.fill ?? '#ffffff'}
          onChange={(e) => applyAll({ fill: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">Stroke</span>
        <input
          type="color"
          aria-label="Stroke color"
          value={current.stroke ?? '#333333'}
          onChange={(e) => applyAll({ stroke: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-border bg-surface"
        />
      </label>

      <label className="mb-2 block">
        <span className="mb-1 block text-xs text-muted">
          Stroke width: {current.strokeWidth ?? 1}px
        </span>
        <input
          type="range"
          min={1}
          max={8}
          step={0.5}
          value={current.strokeWidth ?? 1}
          onChange={(e) => applyAll({ strokeWidth: Number(e.target.value) })}
          className="w-full"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => applyAll(preset.style)}
            className="rounded border border-border px-2 py-1 text-xs hover:bg-surface-alt"
            style={{ background: preset.style.fill, color: preset.style.fontColor }}
            title={preset.name}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </aside>
  );
}

const PRESETS = [
  { name: 'Success', style: { fill: '#dcfce7', stroke: '#16a34a', fontColor: '#14532d' } },
  { name: 'Warning', style: { fill: '#fef3c7', stroke: '#d97706', fontColor: '#78350f' } },
  { name: 'Error', style: { fill: '#fee2e2', stroke: '#dc2626', fontColor: '#7f1d1d' } },
  { name: 'Muted', style: { fill: '#f3f4f6', stroke: '#6b7280', fontColor: '#374151' } },
] as const;
