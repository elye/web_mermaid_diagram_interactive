/**
 * uiStore — theme, viewport, panel visibility, and transient toasts.
 */
import { create } from 'zustand';
import type { ViewportState } from '@/shared/types/diagram';
import { nextId } from '@/shared/utils/idGenerator';

export type Theme = 'light' | 'dark' | 'system';

/**
 * Controls which neighbours are highlighted when a node/edge/cluster is selected.
 *   both        — sources (upstream) AND sinks (downstream) are highlighted (default)
 *   only-sources — only upstream source nodes are highlighted
 *   only-sinks   — only downstream sink nodes are highlighted
 *   only-both    — only bidirectional neighbours (<-->) are highlighted
 *   none         — no connectivity highlighting
 */
export type ConnectivityMode = 'both' | 'only-sources' | 'only-sinks' | 'only-both' | 'none';

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  message: string;
  duration?: number;
}

export interface UiState {
  theme: Theme;
  viewport: ViewportState;
  showMinimap: boolean;
  connectivityMode: ConnectivityMode;
  /** Whether to show hover tooltips on nodes and edges. On by default. */
  showTooltip: boolean;
  toasts: Toast[];

  setTheme: (t: Theme) => void;
  setViewport: (v: Partial<ViewportState>) => void;
  toggleMinimap: () => void;
  setConnectivityMode: (mode: ConnectivityMode) => void;
  toggleTooltip: () => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  hydrate: (patch: Partial<UiState>) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  viewport: { zoom: 1, panX: 0, panY: 0 },
  showMinimap: true,
  connectivityMode: 'both',
  showTooltip: true,
  toasts: [],

  setTheme: (t) => set({ theme: t }),
  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),
  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
  setConnectivityMode: (mode) => set({ connectivityMode: mode }),
  toggleTooltip: () => set((s) => ({ showTooltip: !s.showTooltip })),
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { id: nextId('toast'), ...t }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  hydrate: (patch) => set(patch),
}));
