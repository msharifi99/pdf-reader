// Svelte transitions that follow the motion tokens and collapse to 0 ms under reduced motion.
import type { TransitionConfig } from 'svelte/transition';
import { reducedMotion } from './themes';

export { reducedMotion };

export const durations = { instant: 80, fast: 120, base: 160, slow: 200, chrome: 200 } as const;

// cubic-bezier(0.16, 1, 0.3, 1) approximated as a quint ease-out; close enough for JS tweens.
export const easeOut = (t: number) => 1 - (1 - t) ** 5;
export const easeIn = (t: number) => t ** 3;

type Opts = { duration?: number; delay?: number };

const d = (ms: number | undefined, fallback: number) => (reducedMotion() ? 0 : (ms ?? fallback));

/** Opacity only. For chrome, toasts leaving, scrims. */
export function fade(_node: Element, { duration, delay = 0 }: Opts = {}): TransitionConfig {
  return { duration: d(duration, durations.base), delay, easing: easeOut, css: (t) => `opacity:${t}` };
}

/** Popovers, menus, tooltips: fade + 4px drift + 0.98 scale from the anchored edge. */
export function fadeScale(
  _node: Element,
  { duration, delay = 0, from = 'top', start = 0.98 }: Opts & { from?: 'top' | 'bottom' | 'left' | 'right' | 'center'; start?: number } = {},
): TransitionConfig {
  const [x, y] = { top: [0, -4], bottom: [0, 4], left: [-4, 0], right: [4, 0], center: [0, 0] }[from];
  return {
    duration: d(duration, durations.base),
    delay,
    easing: easeOut,
    css: (t, u) => `opacity:${t};transform:translate(${x * u}px,${y * u}px) scale(${start + (1 - start) * t})`,
  };
}

/** Sidebars and drawers: slide in from an edge with a fade; travel is small (24px) so it stays calm. */
export function slide(
  _node: Element,
  { duration, delay = 0, side = 'left', distance = 24 }: Opts & { side?: 'left' | 'right' | 'top' | 'bottom'; distance?: number } = {},
): TransitionConfig {
  const axis = side === 'left' || side === 'right' ? 'X' : 'Y';
  const sign = side === 'left' || side === 'top' ? -1 : 1;
  return {
    duration: d(duration, durations.slow),
    delay,
    easing: easeOut,
    css: (t, u) => `opacity:${t};transform:translate${axis}(${sign * distance * u}px)`,
  };
}
