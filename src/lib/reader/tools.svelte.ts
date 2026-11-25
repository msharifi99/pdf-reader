/** Focus tools (stories 79–81): focus mode, reading ruler, auto-scroll. */
import { commands } from '../commands';
import { reducedMotion } from '../design/motion';
import { settings } from '../stores/settings.svelte';
import type { ReaderSession } from './session.svelte';

/** px/s steps for scrolled flows, seconds-per-page steps for paginated ones. */
export const SCROLL_SPEEDS = [8, 12, 16, 24, 32, 40, 52, 66, 84, 110, 140, 180];
export const TURN_SECONDS = [90, 60, 45, 35, 28, 22, 18, 14, 11, 8, 6, 4];
const RESUME_AFTER = 2500;
const OWN = new Set(['reader.toggleAutoScroll', 'reader.autoScrollFaster', 'reader.autoScrollSlower', 'reader.toggleRuler', 'reader.toggleFocus']);

export class ReadingTools {
  focus = $state(false);
  ruler = $state(false);
  /** band top, px from the stage top */
  rulerTop = $state(160);
  auto = $state<'off' | 'running' | 'paused'>('off');
  /** HUD visible until this time (ms, performance.now) */
  hudUntil = $state(0);
  #session: ReaderSession;
  #raf = 0;
  #turnTimer: ReturnType<typeof setTimeout> | undefined;
  #resumeTimer: ReturnType<typeof setTimeout> | undefined;
  #hudTimer: ReturnType<typeof setTimeout> | undefined;
  #carry = 0;
  #last = 0;
  #offs: (() => void)[] = [];

  constructor(session: ReaderSession) {
    this.#session = session;
  }

  get scrolled(): boolean {
    return this.#session.flow === 'scrolled';
  }
  get rulerHeight(): number {
    return settings.value.reader.rulerHeight;
  }
  setRulerHeight(px: number): void {
    settings.update('reader', (r) => ({ ...r, rulerHeight: Math.round(Math.min(320, Math.max(28, px))) }));
  }

  /** "40 px/s" or "a page every 20 s" */
  get speedLabel(): string {
    const r = settings.value.reader;
    return this.scrolled ? `${r.autoScrollSpeed} px/s` : `a page every ${r.autoTurnSeconds} s`;
  }

  // ---- focus mode --------------------------------------------------------------------------

  setFocus(on: boolean): void {
    this.focus = on;
    const root = document.documentElement;
    if (on) root.dataset.readerFocus = '';
    else delete root.dataset.readerFocus;
  }

  // ---- auto-scroll -------------------------------------------------------------------------

  toggleAuto(): void {
    if (this.auto === 'off') this.startAuto();
    else this.stopAuto();
  }

  startAuto(): void {
    this.stopAuto();
    this.auto = 'running';
    this.#flashHud();
    // the user's own input pauses it for a moment; our own commands don't
    const pause = () => this.#pauseForInput();
    const opts = { passive: true, capture: true } as const;
    window.addEventListener('wheel', pause, opts);
    window.addEventListener('pointerdown', pause, opts);
    this.#offs.push(
      () => window.removeEventListener('wheel', pause, opts),
      () => window.removeEventListener('pointerdown', pause, opts),
      commands.onExecute((e) => {
        if (e.id.startsWith('reader.') && !OWN.has(e.id)) this.#pauseForInput();
      }),
    );
    this.#tick();
  }

  stopAuto(): void {
    cancelAnimationFrame(this.#raf);
    clearTimeout(this.#turnTimer);
    clearTimeout(this.#resumeTimer);
    this.#offs.splice(0).forEach((f) => f());
    this.#raf = 0;
    if (this.auto !== 'off') this.#flashHud();
    this.auto = 'off';
  }

  changeSpeed(dir: 1 | -1): void {
    settings.update('reader', (r) => {
      if (this.scrolled) {
        const i = nearest(SCROLL_SPEEDS, r.autoScrollSpeed);
        return { ...r, autoScrollSpeed: SCROLL_SPEEDS[clampIdx(i + dir, SCROLL_SPEEDS)]! };
      }
      const i = nearest(TURN_SECONDS, r.autoTurnSeconds);
      return { ...r, autoTurnSeconds: TURN_SECONDS[clampIdx(i + dir, TURN_SECONDS)]! };
    });
    this.#flashHud();
    if (this.auto === 'running' && !this.scrolled) this.#scheduleTurn();
  }

  #flashHud(): void {
    this.hudUntil = performance.now() + 1600;
    clearTimeout(this.#hudTimer);
    this.#hudTimer = setTimeout(() => (this.hudUntil = 0), 1650);
  }

  #pauseForInput(): void {
    if (this.auto === 'off') return;
    if (this.auto === 'running') {
      cancelAnimationFrame(this.#raf);
      clearTimeout(this.#turnTimer);
      this.auto = 'paused';
    }
    clearTimeout(this.#resumeTimer);
    this.#resumeTimer = setTimeout(() => {
      if (this.auto !== 'paused') return;
      this.auto = 'running';
      this.#tick();
    }, RESUME_AFTER);
  }

  #tick(): void {
    if (this.scrolled) {
      this.#last = performance.now();
      this.#carry = 0;
      const frame = (now: number) => {
        if (this.auto !== 'running') return;
        const dt = Math.min(0.1, (now - this.#last) / 1000);
        this.#last = now;
        this.#carry += settings.value.reader.autoScrollSpeed * dt;
        const whole = Math.floor(this.#carry); // scrollTop drops sub-pixel steps: move in whole pixels
        if (whole >= 1) {
          this.#carry -= whole;
          this.#session.engine?.scrollBy(whole);
        }
        this.#raf = requestAnimationFrame(frame);
      };
      this.#raf = requestAnimationFrame(frame);
    } else this.#scheduleTurn();
  }

  #scheduleTurn(): void {
    clearTimeout(this.#turnTimer);
    this.#turnTimer = setTimeout(async () => {
      if (this.auto !== 'running') return;
      const moved = await this.#session.engine?.next().catch(() => false);
      if (!moved) return this.stopAuto(); // end of the book
      this.#scheduleTurn();
    }, settings.value.reader.autoTurnSeconds * 1000);
  }

  dispose(): void {
    this.stopAuto();
    clearTimeout(this.#hudTimer);
    this.setFocus(false);
  }
}

function nearest(list: number[], v: number): number {
  let best = 0;
  list.forEach((x, i) => {
    if (Math.abs(x - v) < Math.abs(list[best]! - v)) best = i;
  });
  return best;
}
const clampIdx = (i: number, list: number[]) => Math.max(0, Math.min(list.length - 1, i));

/** Animated scroll by `dy` (160 ms ease-out) in scrolled flows; instant when motion is off. */
export function smoothScroll(session: ReaderSession, dy: number, ms = 170): Promise<void> {
  const e = session.engine;
  if (!e) return Promise.resolve();
  if (reducedMotion() || !settings.value.pageAnimations) {
    e.scrollBy(Math.round(dy));
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    let done = 0;
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const target = Math.round(dy * (1 - (1 - t) ** 3));
      if (target !== done) {
        e.scrollBy(target - done);
        done = target;
      }
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
