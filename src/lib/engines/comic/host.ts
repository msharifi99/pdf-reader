import type { EngineEventMap, Fit, Presentation, ReadingDirection, RelocatedEvent, Spread } from '../types';
import type { Painter, TintState } from './painter';
import type { Size } from './layout';

/** What a view needs from the engine (the engine is the only implementer). */
export interface ViewHost {
  count: number;
  readonly painter: Painter;
  settings(): { rotation: 0 | 90 | 180 | 270; fit: Fit; zoom: number; spread: Spread; direction: ReadingDirection; gap: number; tint: TintState };
  dims(page: number): Size | undefined;
  /** Sync cache hit (touches LRU recency), else undefined. */
  cached(page: number): ImageBitmap | undefined;
  /** Decode (or fetch from cache) and return live bitmaps in the order asked. Never rejects: failed pages get a placeholder. */
  bitmaps(pages: number[]): Promise<ImageBitmap[]>;
  /** Warm the cache for pages around the reading position. */
  preload(pages: number[]): void;
  reduceMotion(): boolean;
  relocated(page: number, y: number, reason: RelocatedEvent['reason']): void;
  presentation(p: Partial<Presentation>): void;
  pointer(ev: EngineEventMap['pointer']): void;
  layoutChanged(): void;
  /** A page box (`.q-pg`, holding the canvas) was created: the engine adds the OCR and decoration layers. */
  mounted(page: number, box: HTMLElement): void;
}

export interface PageView {
  /** Current first visible page. */
  readonly page: number;
  goTo(page: number, y: number, reason: RelocatedEvent['reason']): Promise<void>;
  next(): Promise<boolean>;
  prev(): Promise<boolean>;
  scrollBy(dy: number): void;
  /** Re-measure and redraw after a resize or a fit/zoom change. */
  relayout(): void;
  /** Redraw pixels (tint or theme changed). */
  repaint(): void;
  /** A page's real size became known. */
  onDims(page: number): void;
  /** Zoom by `factor` around a viewport point. */
  zoomAt(factor: number, clientX: number, clientY: number): void;
  /** The element that scrolls (for drag-pan). */
  scroller(): HTMLElement | null;
  stats(): Record<string, number>;
  dispose(): void;
}
