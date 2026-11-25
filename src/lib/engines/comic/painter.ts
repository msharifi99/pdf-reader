/** Draws a page bitmap into a canvas at display size with the chosen Page Tint (same three modes as the PDF engine). */
import type { PageTint } from '../types';
import { GlTinter, INVERT_FILTER, smartTintImageData, type RGB } from '../pdf/tint';

export interface TintState {
  mode: PageTint;
  bg: RGB;
  fg: RGB;
}

/** Backing-store cap per side; beyond this the canvas is CSS-scaled (extreme zoom). */
const MAX_BACKING = 4096;

export class Painter {
  private gl: GlTinter | null | undefined;

  paint(canvas: HTMLCanvasElement, bitmap: ImageBitmap, cssW: number, cssH: number, tint: TintState, rotation = 0): void {
    const dpr = window.devicePixelRatio || 1;
    const k = Math.min(1, MAX_BACKING / Math.max(cssW * dpr, cssH * dpr));
    const w = Math.max(1, Math.round(cssW * dpr * k));
    const h = Math.max(1, Math.round(cssH * dpr * k));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    // cssW/cssH are the displayed (rotated) size; the bitmap is drawn pre-rotation around the centre.
    const swap = rotation % 180 !== 0;
    const draw = (src: CanvasImageSource) => {
      if (!rotation) return ctx.drawImage(src, 0, 0, w, h);
      const dw = swap ? h : w;
      const dh = swap ? w : h;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    };
    if (tint.mode === 'smart') {
      this.gl ??= GlTinter.create();
      if (this.gl) {
        draw(this.gl.tint(bitmap, tint.bg, tint.fg, []));
      } else {
        draw(bitmap);
        const img = ctx.getImageData(0, 0, w, h);
        smartTintImageData(img, tint.bg, tint.fg, []);
        ctx.putImageData(img, 0, 0);
      }
    } else {
      if (tint.mode === 'invert') ctx.filter = INVERT_FILTER;
      draw(bitmap);
      ctx.filter = 'none';
    }
  }

  dispose(): void {
    this.gl?.dispose();
    this.gl = undefined;
  }
}
