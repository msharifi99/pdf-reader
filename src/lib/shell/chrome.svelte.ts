/**
 * Chrome auto-hide (SPEC stories 65, 66). Sets `<html data-chrome-hidden>` after `delay` ms without
 * input while enabled (the shell enables it in the reader only). Every `[data-chrome]` element fades.
 *
 *   import { chrome } from '../shell/chrome.svelte';
 *   chrome.hidden                 reactive
 *   chrome.show()                 bring it back now (e.g. a sidebar opened)
 *   const release = chrome.hold() keep it visible until release() (e.g. while a panel is pinned)
 *
 * It never hides while the pointer is over chrome, a menu/popover/dialog is open, an overlay is up,
 * or focus is inside chrome.
 */
export interface ChromeOptions {
  delay: () => number;
  enabled: () => boolean;
  /** extra "keep visible" condition (open shell overlays) */
  blocked?: () => boolean;
}

/** Keys that turn pages or scroll: reading with them must not wake the chrome every page. */
const READING_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Home', 'End', 'j', 'k',
]);

class ChromeController {
  hidden = $state(false);
  #timer: ReturnType<typeof setTimeout> | undefined;
  #holds = 0;
  #opts: ChromeOptions | null = null;
  #last = { x: -1, y: -1 };
  #overChrome = false;

  hold(): () => void {
    this.#holds++;
    this.show();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.#holds--;
      this.#arm();
    };
  }

  show(): void {
    if (this.hidden) this.#set(false);
    this.#arm();
  }

  /** Re-evaluate (call when enabled() may have changed). */
  refresh(): void {
    if (!this.#opts?.enabled()) {
      clearTimeout(this.#timer);
      this.#set(false);
      return;
    }
    this.#arm();
  }

  install(opts: ChromeOptions): () => void {
    this.#opts = opts;
    const onMove = (e: PointerEvent) => {
      // the cursor is hidden while chrome is: ignore sub-pixel jitter and synthetic zero moves
      const dx = Math.abs(e.clientX - this.#last.x);
      const dy = Math.abs(e.clientY - this.#last.y);
      this.#last = { x: e.clientX, y: e.clientY };
      this.#overChrome = !!(e.target as Element | null)?.closest?.('[data-chrome]');
      if (dx + dy < 3) return;
      this.show();
    };
    const onKey = (e: KeyboardEvent) => {
      if (READING_KEYS.has(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (!this.hidden) this.#arm();
        return;
      }
      this.show();
    };
    const onWake = () => this.show();
    const onLeave = () => (this.#overChrome = false);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onWake, { passive: true });
    window.addEventListener('wheel', onWake, { passive: true });
    window.addEventListener('keydown', onKey, true);
    document.documentElement.addEventListener('pointerleave', onLeave);
    this.refresh();
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onWake);
      window.removeEventListener('wheel', onWake);
      window.removeEventListener('keydown', onKey, true);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      clearTimeout(this.#timer);
      this.#set(false);
      this.#opts = null;
    };
  }

  #arm() {
    clearTimeout(this.#timer);
    const o = this.#opts;
    if (!o?.enabled()) return;
    this.#timer = setTimeout(() => this.#tryHide(), Math.max(500, o.delay()));
  }

  #tryHide() {
    const o = this.#opts;
    if (!o?.enabled()) return this.#set(false);
    if (this.#keepVisible()) return this.#arm(); // check again after another idle period
    this.#set(true);
  }

  #keepVisible(): boolean {
    if (this.#holds > 0 || this.#overChrome || this.#opts?.blocked?.()) return true;
    if (document.querySelector('[popover]:popover-open:not([role=tooltip]), dialog[open]')) return true;
    const a = document.activeElement;
    return !!(a && a !== document.body && a.closest('[data-chrome]') && a.matches(':focus-visible'));
  }

  #set(h: boolean) {
    if (this.hidden === h) return;
    this.hidden = h;
    const root = document.documentElement;
    if (h) root.dataset.chromeHidden = '';
    else delete root.dataset.chromeHidden;
  }
}

export const chrome = new ChromeController();
