/**
 * autoSave — persists the current state to localStorage on an interval,
 * and offers restoreAutoSave() on startup.
 */
import { AUTOSAVE_DEBOUNCE_MS } from '@/shared/constants/defaults';
import { serializeToJson, buildFileObject } from './fileSerializer';
import { hydrateFromFile } from './fileParser';
import { useDiagramStore } from '@/stores/diagramStore';
import { useStyleStore } from '@/stores/styleStore';
import { useUiStore } from '@/stores/uiStore';

const STORAGE_KEY = 'mf.autosave.v1';

let timer: number | null = null;
let unsubscribes: Array<() => void> = [];

/**
 * Start the autosave loop. Safe to call multiple times (idempotent).
 *
 * Subscribes to EVERY persisted store (diagram, style, UI) so any user
 * change \u2014 node move, waypoint drag, edge color, theme swap \u2014 debounces
 * a save. A single localStorage key holds the merged snapshot.
 */
let unloadListenersRegistered = false;

export function startAutoSave(): void {
  if (!unloadListenersRegistered && typeof window !== 'undefined') {
    // `pagehide` is the modern, bfcache-safe unload signal; `beforeunload`
    // covers older desktop paths. Both flush any pending debounced save so a
    // change made in the last few hundred ms before refresh isn't lost.
    window.addEventListener('pagehide', flushAutoSave);
    window.addEventListener('beforeunload', flushAutoSave);
    unloadListenersRegistered = true;
  }

  if (unsubscribes.length) return;
  unsubscribes.push(useDiagramStore.subscribe(() => scheduleSave()));
  unsubscribes.push(useStyleStore.subscribe(() => scheduleSave()));
  unsubscribes.push(useUiStore.subscribe(() => scheduleSave()));
  // No immediate scheduleSave() here: subscribers already cover every real
  // state change. Saving on boot would either be a no-op (identical to the
  // hydrated state) or, worse, race with hydration and clobber a fresh restore.
}

function scheduleSave() {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(persistNow, AUTOSAVE_DEBOUNCE_MS);
}

function persistNow() {
  timer = null;
  try {
    localStorage.setItem(STORAGE_KEY, serializeToJson());
  } catch {
    /* quota full — ignored */
  }
}

/**
 * Synchronously write the current state to localStorage, cancelling any
 * pending debounced timer. Called on `pagehide` / `beforeunload` so that
 * a change made just before a refresh survives.
 */
export function flushAutoSave(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  persistNow();
}

/**
 * If a previous session exists, hydrate stores from it.
 * Returns true if a restore occurred.
 */
export function restoreAutoSave(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const file = JSON.parse(raw);
    if (file?.version !== '1.0' && file?.version !== '1.1' && file?.version !== '1.2') return false;
    hydrateFromFile(file);
    startAutoSave();
    return true;
  } catch {
    return false;
  } finally {
    // Even on the "no restore" path we still want to start autosaving.
    startAutoSave();
  }
}

/**
 * Public helper for tests / debugging.
 */
export function _peekAutoSave(): unknown {
  return buildFileObject();
}
