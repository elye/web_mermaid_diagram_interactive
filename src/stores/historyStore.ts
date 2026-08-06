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
 *
 * Two ways to record a step:
 *   - `commit()` — immediate, always pushes a new undo step. Used where the
 *     caller already knows the interaction's boundaries (node/edge drag
 *     commits once on the first move; "Reset to original" is a single
 *     deliberate action).
 *   - `commitCoalesced(key)` — for UI controls that fire many events per
 *     logical edit (range sliders, color pickers, rapid preset clicks). See
 *     its doc comment below.
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
  clusterStyles: Record<string, unknown>;
  annotations: unknown[];
}

interface HistoryState {
  past: Snapshot[];
  future: Snapshot[];
  commit: () => void;
  /**
   * Coalescing variant of `commit()` for rapid bursts of edits to the same
   * target (e.g. dragging a stroke-width slider, or clicking through
   * several color presets on the same selected node/edge). Only the FIRST
   * call for a given `key` since the last idle pause (or key change) pushes
   * a history entry — later calls with the same key just extend the idle
   * window, so one drag/burst of edits collapses into a single undo step.
   * `key` should identify the target being edited (e.g. the selected node
   * or edge id set) so switching targets always starts a fresh step.
   */
  commitCoalesced: (key: string) => void;
  /** Close the current coalesced session so the next `commitCoalesced` call
   * (even with the same key) starts a fresh undo step. */
  endCoalesce: () => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

/** How long a burst of same-key `commitCoalesced` calls may pause before the
 * next call is treated as a new editing session. */
const COALESCE_IDLE_MS = 800;

// Ephemeral interaction bookkeeping — not app state, so it lives outside the
// Zustand store (no need to trigger re-renders when it changes).
let coalesceKey: string | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

function closeCoalesceSession(): void {
  coalesceKey = null;
  if (coalesceTimer !== null) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
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
    clusterStyles: clone(s.clusterStyles),
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
    clusterStyles: snap.clusterStyles as Record<string, never>,
    annotations: snap.annotations as never[],
  });
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  commit: () =>
    set((s) => {
      closeCoalesceSession();
      const next = [...s.past, snapshot()];
      if (next.length > HISTORY_LIMIT) next.shift();
      return { past: next, future: [] };
    }),
  commitCoalesced: (key) => {
    if (coalesceKey !== key) {
      get().commit();
      coalesceKey = key;
    }
    if (coalesceTimer !== null) clearTimeout(coalesceTimer);
    coalesceTimer = setTimeout(closeCoalesceSession, COALESCE_IDLE_MS);
  },
  endCoalesce: () => closeCoalesceSession(),
  undo: () => {
    closeCoalesceSession();
    const { past } = get();
    if (past.length === 0) return;
    const current = snapshot();
    const previous = past[past.length - 1];
    apply(previous);
    set((s) => ({ past: past.slice(0, -1), future: [current, ...s.future] }));
  },
  redo: () => {
    closeCoalesceSession();
    const { future } = get();
    if (future.length === 0) return;
    const current = snapshot();
    const [next, ...rest] = future;
    apply(next);
    set((s) => ({ past: [...s.past, current], future: rest }));
  },
  clear: () => {
    closeCoalesceSession();
    set({ past: [], future: [] });
  },
}));
