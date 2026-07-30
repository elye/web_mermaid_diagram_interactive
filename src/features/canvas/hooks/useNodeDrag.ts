/**
 * useNodeDrag — attaches drag handlers to node <g> elements inside the
 * rendered SVG. On drag, updates the group's transform live; on release,
 * commits the position override to diagramStore.
 *
 * We piggyback on Mermaid's native `transform="translate(x,y)"` on node
 * groups, layering our override on top.
 */
import { useEffect } from 'react';
import { useDiagramStore } from '@/stores/diagramStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useUiStore } from '@/stores/uiStore';

interface DragCtx {
  id: string;
  origX: number;
  origY: number;
  pointerStartX: number;
  pointerStartY: number;
  group: SVGGElement;
}

export function useNodeDrag(svgHostRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;

    let ctx: DragCtx | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      const group = target.closest('g[data-node-id]') as SVGGElement | null;
      if (!group) return;

      const id = group.getAttribute('data-node-id')!;
      const additive = e.shiftKey;
      useSelectionStore.getState().select(id, additive);

      const override = useDiagramStore.getState().positionOverrides[id];
      const { origX, origY } = readTranslate(group, override);

      ctx = {
        id,
        group,
        origX,
        origY,
        pointerStartX: e.clientX,
        pointerStartY: e.clientY,
      };
      group.classList.add('mf-node--dragging');
      e.stopPropagation();
      (host as HTMLElement).setPointerCapture?.(e.pointerId);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!ctx) return;
      const zoom = useUiStore.getState().viewport.zoom;
      const dx = (e.clientX - ctx.pointerStartX) / zoom;
      const dy = (e.clientY - ctx.pointerStartY) / zoom;
      writeTranslate(ctx.group, ctx.origX + dx, ctx.origY + dy);
      // Re-route connected edges live.
      rerouteEdgesFor(ctx.id, ctx.group);
    };

    const onPointerUp = () => {
      if (!ctx) return;
      const zoom = useUiStore.getState().viewport.zoom;
      const dxScreen =
        (readTranslate(ctx.group).origX - ctx.origX) * zoom; /* no-op placeholder */
      void dxScreen;
      const finalPos = readTranslate(ctx.group);
      useHistoryStore.getState().commit();
      useDiagramStore.getState().setPositionOverride(ctx.id, {
        x: finalPos.origX,
        y: finalPos.origY,
      });
      ctx.group.classList.remove('mf-node--dragging');
      ctx = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    host.addEventListener('pointerdown', onPointerDown as EventListener);
    return () => {
      host.removeEventListener('pointerdown', onPointerDown as EventListener);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    // Re-attach whenever the SVG content changes (new render).
  }, [svgHostRef]);
}

function readTranslate(
  g: SVGGElement,
  override?: { x: number; y: number },
): { origX: number; origY: number } {
  if (override) return { origX: override.x, origY: override.y };
  const t = g.getAttribute('transform') ?? '';
  const m = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(t);
  return { origX: m ? Number(m[1]) : 0, origY: m ? Number(m[2]) : 0 };
}

function writeTranslate(g: SVGGElement, x: number, y: number) {
  g.setAttribute('transform', `translate(${x}, ${y})`);
}

/**
 * Best-effort edge rerouting: for every path adjacent to the dragged node,
 * rewrite its `d` attribute to a straight-ish cubic bezier between the
 * connected node centers. Falls back to leaving the path untouched.
 */
function rerouteEdgesFor(nodeId: string, host: SVGGElement) {
  const svg = host.ownerSVGElement;
  if (!svg) return;
  const edges = svg.querySelectorAll<SVGPathElement>('path[data-edge-id]');
  edges.forEach((path) => {
    const id = path.getAttribute('data-edge-id') ?? '';
    const m = /^L-([^-]+)-([^-]+)/.exec(id);
    if (!m) return;
    if (m[1] !== nodeId && m[2] !== nodeId) return;
    const src = svg.querySelector<SVGGElement>(`g[data-node-id="${m[1]}"]`);
    const dst = svg.querySelector<SVGGElement>(`g[data-node-id="${m[2]}"]`);
    if (!src || !dst) return;
    const a = centerOfGroup(src);
    const b = centerOfGroup(dst);
    const dx = (b.x - a.x) * 0.5;
    path.setAttribute(
      'd',
      `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`,
    );
  });
}

function centerOfGroup(g: SVGGElement): { x: number; y: number } {
  const t = /translate\(\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*\)/.exec(
    g.getAttribute('transform') ?? '',
  );
  const tx = t ? Number(t[1]) : 0;
  const ty = t ? Number(t[2]) : 0;
  const bbox = (g.querySelector('rect') ?? g.querySelector('polygon') ?? g.querySelector('circle')) as
    | SVGGraphicsElement
    | null;
  if (bbox && 'getBBox' in bbox) {
    try {
      const b = bbox.getBBox();
      return { x: tx + b.x + b.width / 2, y: ty + b.y + b.height / 2 };
    } catch {
      /* jsdom */
    }
  }
  return { x: tx, y: ty };
}
