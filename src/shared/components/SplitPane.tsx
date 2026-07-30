/**
 * SplitPane
 * ---------
 * Resizable horizontal split. Left/right panes; drag the divider to resize.
 * Percentage-based so it stays responsive. Persists ratio in localStorage.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'mf.splitPane.ratio';
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  initialRatio?: number;
}

export function SplitPane({ left, right, initialRatio = 0.4 }: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? clamp(parsed) : initialRatio;
  });
  const draggingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(ratio));
  }, [ratio]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const raw = (e.clientX - rect.left) / rect.width;
    setRatio(clamp(raw));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div ref={containerRef} className="flex h-full w-full flex-row overflow-hidden">
      <div style={{ width: `${ratio * 100}%` }} className="h-full min-w-0 overflow-hidden">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setRatio((r) => clamp(r - 0.02));
          if (e.key === 'ArrowRight') setRatio((r) => clamp(r + 0.02));
        }}
        className="w-1 cursor-col-resize bg-border transition-colors hover:bg-accent focus:bg-accent"
      />
      <div style={{ width: `${(1 - ratio) * 100}%` }} className="h-full min-w-0 overflow-hidden">
        {right}
      </div>
    </div>
  );
}

function clamp(v: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, v));
}
