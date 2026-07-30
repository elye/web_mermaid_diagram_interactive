/**
 * uiStore — theme, viewport, panel visibility, and transient toasts.
 */
import { create } from 'zustand';
import type { ViewportState } from '@/shared/types/diagram';
import { nextId } from '@/shared/utils/idGenerator';

export type Theme = 'light' | 'dark' | 'system';

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
  toasts: Toast[];

  setTheme: (t: Theme) => void;
  setViewport: (v: Partial<ViewportState>) => void;
  toggleMinimap: () => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  hydrate: (patch: Partial<UiState>) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: 'system',
  viewport: { zoom: 1, panX: 0, panY: 0 },
  showMinimap: true,
  toasts: [],

  setTheme: (t) => set({ theme: t }),
  setViewport: (v) => set((s) => ({ viewport: { ...s.viewport, ...v } })),
  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
  pushToast: (t) => set((s) => ({ toasts: [...s.toasts, { id: nextId('toast'), ...t }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  hydrate: (patch) => set(patch),
}));
