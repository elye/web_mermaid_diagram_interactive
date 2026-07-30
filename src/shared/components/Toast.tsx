/**
 * Toast — tiny transient notification system driven by uiStore.
 */
import { useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';

export function ToastContainer() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  useEffect(() => {
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismissToast(t.id), t.duration ?? 4000),
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismissToast]);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto min-w-[220px] max-w-[380px] rounded-md border border-border bg-surface-alt px-3 py-2 text-sm shadow-lg ${
            t.kind === 'error' ? 'border-red-500 text-red-400' : ''
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
