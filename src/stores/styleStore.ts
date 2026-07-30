/**
 * styleStore — per-element style overrides and floating annotations.
 */
import { create } from 'zustand';
import type { StyleOverride, Annotation } from '@/shared/types/diagram';

export interface StyleState {
  nodeStyles: Record<string, StyleOverride>;
  edgeStyles: Record<string, StyleOverride>;
  annotations: Annotation[];

  setNodeStyle: (id: string, patch: StyleOverride) => void;
  clearNodeStyle: (id: string) => void;
  setEdgeStyle: (id: string, patch: StyleOverride) => void;
  clearEdgeStyle: (id: string) => void;
  addAnnotation: (a: Annotation) => void;
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  hydrate: (patch: Partial<StyleState>) => void;
  reset: () => void;
}

export const useStyleStore = create<StyleState>((set) => ({
  nodeStyles: {},
  edgeStyles: {},
  annotations: [],
  setNodeStyle: (id, patch) =>
    set((s) => ({ nodeStyles: { ...s.nodeStyles, [id]: { ...s.nodeStyles[id], ...patch } } })),
  clearNodeStyle: (id) =>
    set((s) => {
      const next = { ...s.nodeStyles };
      delete next[id];
      return { nodeStyles: next };
    }),
  setEdgeStyle: (id, patch) =>
    set((s) => ({ edgeStyles: { ...s.edgeStyles, [id]: { ...s.edgeStyles[id], ...patch } } })),
  clearEdgeStyle: (id) =>
    set((s) => {
      const next = { ...s.edgeStyles };
      delete next[id];
      return { edgeStyles: next };
    }),
  addAnnotation: (a) => set((s) => ({ annotations: [...s.annotations, a] })),
  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  removeAnnotation: (id) =>
    set((s) => ({ annotations: s.annotations.filter((a) => a.id !== id) })),
  hydrate: (patch) => set(patch),
  reset: () => set({ nodeStyles: {}, edgeStyles: {}, annotations: [] }),
}));
