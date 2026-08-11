import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'mf.autosave.v1';

/**
 * The autosave module holds module-scoped state (a debounce timer and a
 * `unloadListenersRegistered` flag). To exercise a clean instance each test
 * we do `vi.resetModules()` and then re-import BOTH `autoSave` and the
 * store modules from the fresh graph — otherwise subscriptions fire on a
 * different store instance than the one the test mutates.
 */
async function freshEnv() {
  vi.resetModules();
  const autoSave = await import('./autoSave');
  const { useDiagramStore } = await import('@/stores/diagramStore');
  const { useStyleStore } = await import('@/stores/styleStore');
  return { autoSave, useDiagramStore, useStyleStore };
}

describe('autoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists a store change after the debounce elapses', async () => {
    const { autoSave, useDiagramStore } = await freshEnv();
    autoSave.startAutoSave();

    useDiagramStore.getState().setEdgeWaypoints('e1', [{ x: 10, y: 20 }]);

    // Nothing written yet — still inside the debounce window.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    vi.advanceTimersByTime(1000);

    const raw = localStorage.getItem(STORAGE_KEY)!;
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw);
    expect(saved.version).toBe('1.2');
    expect(saved.edgeWaypoints.e1).toEqual([{ x: 10, y: 20 }]);
  });

  it('flushAutoSave writes immediately, cancelling the pending debounce', async () => {
    const { autoSave, useDiagramStore } = await freshEnv();
    autoSave.startAutoSave();

    useDiagramStore.getState().setEdgeWaypoints('e1', [{ x: 1, y: 2 }]);
    autoSave.flushAutoSave();

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.edgeWaypoints.e1).toEqual([{ x: 1, y: 2 }]);
  });

  it('pagehide handler flushes the latest state to localStorage', async () => {
    const { autoSave, useDiagramStore } = await freshEnv();
    autoSave.startAutoSave();

    useDiagramStore.getState().setEdgeAnchorOverride('e1', 'target', {
      side: 'top',
      offset: 0.3,
    });

    // Simulate the tab going away BEFORE the debounce fires.
    window.dispatchEvent(new Event('pagehide'));

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(saved.edgeAnchorOverrides.e1).toEqual({
      target: { side: 'top', offset: 0.3 },
    });
  });

  it('restoreAutoSave hydrates v1.1 state (round-trip)', async () => {
    // Write a snapshot under one module instance …
    const first = await freshEnv();
    first.autoSave.startAutoSave();
    first.useDiagramStore.getState().setEdgeWaypoints('e1', [{ x: 5, y: 5 }]);
    first.useDiagramStore.getState().setEdgeAnchorOverride('e1', 'source', {
      side: 'left',
      offset: 0.5,
    });
    first.useStyleStore.getState().setEdgeStyle('e1', { stroke: '#abcdef' });
    first.autoSave.flushAutoSave();

    // … then simulate a page reload with a completely fresh module graph.
    const second = await freshEnv();
    expect(second.autoSave.restoreAutoSave()).toBe(true);

    expect(second.useDiagramStore.getState().edgeWaypoints.e1).toEqual([
      { x: 5, y: 5 },
    ]);
    expect(second.useDiagramStore.getState().edgeAnchorOverrides.e1).toEqual({
      source: { side: 'left', offset: 0.5 },
    });
    expect(second.useStyleStore.getState().edgeStyles.e1.stroke).toBe('#abcdef');
  });

  it('restoreAutoSave returns false when no snapshot exists', async () => {
    const { autoSave } = await freshEnv();
    expect(autoSave.restoreAutoSave()).toBe(false);
  });

  it('restoreAutoSave returns false for an unknown version', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: '99.0', mermaidSource: 'flowchart TD' }),
    );
    const { autoSave } = await freshEnv();
    expect(autoSave.restoreAutoSave()).toBe(false);
  });

  it('persists and restores collapsedClusters across page refresh', async () => {
    // Session 1: collapse some clusters and flush.
    const first = await freshEnv();
    first.autoSave.startAutoSave();
    first.useDiagramStore.getState().hydrate({
      collapsedClusters: new Set(['subA', 'subB']),
    });
    first.autoSave.flushAutoSave();

    // Verify serialised form uses a plain array.
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(Array.isArray(raw.collapsedClusters)).toBe(true);
    expect(raw.collapsedClusters.sort()).toEqual(['subA', 'subB']);

    // Session 2: fresh module graph simulating page reload.
    const second = await freshEnv();
    expect(second.autoSave.restoreAutoSave()).toBe(true);

    const restored = second.useDiagramStore.getState().collapsedClusters;
    expect(restored).toBeInstanceOf(Set);
    expect(restored.has('subA')).toBe(true);
    expect(restored.has('subB')).toBe(true);
    expect(restored.size).toBe(2);
  });

  it('defaults to empty collapsedClusters when field is missing from saved file', async () => {
    // Simulate an older v1.2 save that predates the collapsedClusters field.
    const oldSave = {
      version: '1.2',
      mermaidSource: 'flowchart TD\n  A --> B',
      positionOverrides: {},
      styleOverrides: {},
      edgeStyles: {},
      edgeWaypoints: {},
      edgeAnchorOverrides: {},
      clusterStyles: {},
      annotations: [],
      theme: 'system',
      viewportState: { zoom: 1, panX: 0, panY: 0 },
      metadata: { createdAt: '2025-01-01', lastModified: '2025-01-01' },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldSave));

    const { autoSave, useDiagramStore } = await freshEnv();
    expect(autoSave.restoreAutoSave()).toBe(true);

    const restored = useDiagramStore.getState().collapsedClusters;
    expect(restored).toBeInstanceOf(Set);
    expect(restored.size).toBe(0);
  });
});
