/**
 * historyStore — coarse-grained undo/redo over serialisable app snapshots.
 *
 * We snapshot every user-visible piece of persistent state on each commit
 * and keep up to HISTORY_LIMIT entries. Covers:
 *   • source (Mermaid text)
 *   • positionOverrides            (node drag)
 *   • edgeWaypoints                (waypoint drag)
 *   • edgeAnchorOverrides          (anchor drag)
 *   • nodeStyles / edgeStyles      (attribute changes)
 *   • annotations
 */
import { create } from 'zustand';
import { HISTORY_LIMIT } from '@/shared/constants/defaults';
import { useDiagramStore } from './diagramStore';
import { useStyleStore } from './styleStore';

interface Snapshot {
  source: string;
  positionOverrides: Record<string, { x: number; y: number }>;
  edgeWaypoints: Record<string, unknown>;
  edgeAnchorOverrides: Record<string, unknown>;
  nodeStyles: Record<string, unknown>;
  edgeStyles: Record<string, unknown>;
  annotations: unknown[];
}

interface HistoryState {
  past: Snapshot[];
  future: Snapshot[];
  commit: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function snapshot(): Snapshot {
  const d = useDiagramStore.getState();
  const s = useStyleStore.getState();
  return {
    source: d.source,
    positionOverrides: clone(d.positionOverrides),
    edgeWaypoints: clone(d.edgeWaypoints),
    edgeAnchorOverrides: clone(d.edgeAnchorOverrides),
    nodeStyles: clone(s.nodeStyles),
    edgeStyles: clone(s.edgeStyles),
    annotations: clone(s.annotations),
  };
}

function apply(snap: Snapshot) {
  useDiagramStore.getState().hydrate({
    source: snap.source,
    positionOverrides: snap.positionOverrides,
    edgeWaypoints: snap.edgeWaypoints as never,
    edgeAnchorOverrides: snap.edgeAnchorOverrides as never,
  });
  useStyleStore.getState().hydrate({
    nodeStyles: snap.nodeStyles as Record<string, never>,
    edgeStyles: snap.edgeStyles as Record<string, never>,
    annotations: snap.annotations as never[],
  });
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  commit: () =>
    set((s) => {
      const next = [...s.past, snapshot()];
      if (next.length > HISTORY_LIMIT) next.shift();
      return { past: next, future: [] };
    }),
  undo: () => {
    const { past } = get();
    if (past.length === 0) return;
    const current = snapshot();
    const previous = past[past.length - 1];
    apply(previous);
    set((s) => ({ past: past.slice(0, -1), future: [current, ...s.future] }));
  },
  redo: () => {
    const { future } = get();
    if (future.length === 0) return;
    const current = snapshot();
    const [next, ...rest] = future;
    apply(next);
    set((s) => ({ past: [...s.past, current], future: rest }));
  },
  clear: () => set({ past: [], future: [] }),
}));
