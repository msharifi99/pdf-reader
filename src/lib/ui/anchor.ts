// Unique ids / CSS anchor names for popover-based components (Tooltip, Popover, Menu).
let n = 0;
export const uid = (prefix = 'q') => `${prefix}-${(++n).toString(36)}`;

export type Placement = 'top' | 'bottom' | 'left' | 'right' | 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

/** CSS anchor positioning (Chromium 125+): position-area + automatic flip. */
export function anchoredStyle(anchor: string, placement: Placement, gap = 6): string {
  const area: Record<Placement, string> = {
    top: 'top',
    bottom: 'bottom',
    left: 'left',
    right: 'right',
    'bottom-start': 'bottom span-right',
    'bottom-end': 'bottom span-left',
    'top-start': 'top span-right',
    'top-end': 'top span-left',
  };
  const side = placement.split('-')[0];
  const margin = { top: 'margin-bottom', bottom: 'margin-top', left: 'margin-right', right: 'margin-left' }[side!];
  const flip = side === 'top' || side === 'bottom' ? 'flip-block' : 'flip-inline';
  return `position-anchor:${anchor};position-area:${area[placement]};${margin}:${gap}px;position-try-fallbacks:${flip};`;
}
