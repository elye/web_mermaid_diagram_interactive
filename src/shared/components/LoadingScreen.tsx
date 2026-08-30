/**
 * LoadingScreen — full-viewport loading indicator shown during initial
 * store hydration (autosave restore). Prevents the default placeholder
 * diagram from flashing before the real state is loaded.
 */

export function LoadingScreen() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-4">
        <div className="mf-spinner" aria-label="Loading" />
        <p className="text-sm text-muted select-none">Loading diagram…</p>
      </div>
    </div>
  );
}
