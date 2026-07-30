/**
 * autoSave — persists the current state to localStorage on an interval,
 * and offers restoreAutoSave() on startup.
 */
import { AUTOSAVE_DEBOUNCE_MS } from '@/shared/constants/defaults';
import { serializeToJson, buildFileObject } from './fileSerializer';
import { hydrateFromFile } from './fileParser';
import { useDiagramStore } from '@/stores/diagramStore';

const STORAGE_KEY = 'mf.autosave.v1';

let timer: number | null = null;
let unsubscribe: (() => void) | null = null;

/**
 * Start the autosave loop. Safe to call multiple times (idempotent).
 */
export function startAutoSave(): void {
  if (unsubscribe) return;
  unsubscribe = useDiagramStore.subscribe(() => scheduleSave());
  scheduleSave();
}

function scheduleSave() {
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serializeToJson());
    } catch {
      /* quota full — ignored */
    }
  }, AUTOSAVE_DEBOUNCE_MS);
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
    if (file?.version !== '1.0') return false;
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
