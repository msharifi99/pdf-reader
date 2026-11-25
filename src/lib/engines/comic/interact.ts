/** Pointer input shared by both views: Ctrl+wheel / two-finger pinch zoom around its centre, drag-to-pan, click zones. */
import type { PageView, ViewHost } from './host';

export function bindInteraction(root: HTMLElement, view: () => PageView | null, host: ViewHost): () => void {
  let pendingZoom = 1;
  let zoomAt = { x: 0, y: 0 };
  let raf = 0;
  const queueZoom = (factor: number, x: number, y: number) => {
    pendingZoom *= factor;
    zoomAt = { x, y };
    raf ||= requestAnimationFrame(() => {
      raf = 0;
      const f = pendingZoom;
      pendingZoom = 1;
      view()?.zoomAt(f, zoomAt.x, zoomAt.y);
    });
  };
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault(); // Chromium reports trackpad pinch as ctrl+wheel
    queueZoom(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX, e.clientY);
  };

  // Two touches: zoom by the change in finger distance, around the midpoint.
  const touches = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  const pinch = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
  };

  // `text`: a mouse press on OCR text starts a text selection, not a pan (it still counts as a click if it does not move).
  let drag: { id: number; x: number; y: number; sl: number; st: number; moved: boolean; el: HTMLElement; text: boolean } | null = null;
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinchDist = pinch().d;
        drag = null;
      }
    }
    if (e.button !== 0 && e.button !== 1) return;
    const el = view()?.scroller();
    if (!el || touches.size > 1) return;
    const text = e.pointerType === 'mouse' && !!(e.target as Element | null)?.closest?.('.q-ocr span');
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop, moved: false, el, text };
  };
  const onMove = (e: PointerEvent) => {
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        const p = pinch();
        if (pinchDist > 0 && p.d > 0) queueZoom(p.d / pinchDist, p.x, p.y);
        pinchDist = p.d;
        return;
      }
    }
    if (!drag || drag.text || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      root.setPointerCapture(e.pointerId);
      drag.el.style.cursor = 'grabbing';
    }
    drag.el.scrollLeft = drag.sl - dx;
    drag.el.scrollTop = drag.st - dy;
  };
  const onUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.el.style.cursor = '';
    if (d.moved || (d.text && Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 4)) return;
    const r = root.getBoundingClientRect();
    const f = (e.clientX - r.left) / Math.max(1, r.width);
    host.pointer({ x: e.clientX - r.left, y: e.clientY - r.top, zone: f < 1 / 3 ? 'left' : f > 2 / 3 ? 'right' : 'center', button: e.button });
  };
  const onCancel = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (drag) drag.el.style.cursor = '';
    drag = null;
  };

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onCancel);
  return () => {
    cancelAnimationFrame(raf);
    root.removeEventListener('wheel', onWheel);
    root.removeEventListener('pointerdown', onDown);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerup', onUp);
    root.removeEventListener('pointercancel', onCancel);
  };
}
