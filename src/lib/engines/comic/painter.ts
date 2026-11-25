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

  paint(canvas: HTMLCanvasElement, bitmap: ImageBitmap, cssW: number, cssH: number, tint: TintState): void {
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
    if (tint.mode === 'smart') {
      this.gl ??= GlTinter.create();
      if (this.gl) {
        ctx.drawImage(this.gl.tint(bitmap, tint.bg, tint.fg, []), 0, 0, w, h);
      } else {
        ctx.drawImage(bitmap, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        smartTintImageData(img, tint.bg, tint.fg, []);
        ctx.putImageData(img, 0, 0);
      }
    } else {
      if (tint.mode === 'invert') ctx.filter = INVERT_FILTER;
      ctx.drawImage(bitmap, 0, 0, w, h);
      ctx.filter = 'none';
    }
  }

  dispose(): void {
    this.gl?.dispose();
    this.gl = undefined;
  }
}
