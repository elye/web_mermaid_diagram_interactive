/**
 * selectionStore — tracks selected node/edge IDs.
 */
import { create } from 'zustand';

export interface SelectionState {
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;

  select: (id: string, additive?: boolean) => void;
  selectEdge: (id: string, additive?: boolean) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedNodeIds: new Set(),
  selectedEdgeIds: new Set(),
  select: (id, additive = false) =>
    set((s) => {
      const next = new Set(additive ? s.selectedNodeIds : []);
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedNodeIds: next, selectedEdgeIds: new Set() };
    }),
  selectEdge: (id, additive = false) =>
    set((s) => {
      const next = new Set(additive ? s.selectedEdgeIds : []);
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedEdgeIds: next, selectedNodeIds: new Set() };
    }),
  clear: () => set({ selectedNodeIds: new Set(), selectedEdgeIds: new Set() }),
  isSelected: (id) => get().selectedNodeIds.has(id) || get().selectedEdgeIds.has(id),
}));
