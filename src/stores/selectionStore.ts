/**
 * selectionStore — tracks selected node/edge/cluster IDs.
 */
import { create } from 'zustand';

export interface SelectionState {
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  selectedClusterId: string | null;

  select: (id: string, additive?: boolean) => void;
  selectCluster: (id: string | null) => void;
  selectEdge: (id: string, additive?: boolean) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedNodeIds: new Set(),
  selectedEdgeIds: new Set(),
  selectedClusterId: null,
  select: (id, additive = false) =>
    set((s) => {
      const next = new Set(additive ? s.selectedNodeIds : []);
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedNodeIds: next, selectedEdgeIds: new Set(), selectedClusterId: null };
    }),
  selectCluster: (id) =>
    set({
      selectedClusterId: id,
      selectedNodeIds: new Set(),
      selectedEdgeIds: new Set(),
    }),
  selectEdge: (id, additive = false) =>
    set((s) => {
      const next = new Set(additive ? s.selectedEdgeIds : []);
      if (additive && next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedEdgeIds: next, selectedNodeIds: new Set(), selectedClusterId: null };
    }),
  clear: () => set({ selectedNodeIds: new Set(), selectedEdgeIds: new Set(), selectedClusterId: null }),
  isSelected: (id) => get().selectedNodeIds.has(id) || get().selectedEdgeIds.has(id),
}));
