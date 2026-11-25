// Quire icon set. 20x20 grid, 1.5px stroke, round caps and joins, 1.75px safe margin.
// Each entry is inner SVG markup; <Icon> supplies the <svg> wrapper and stroke settings.
// Filled parts opt in with `fill="currentColor" stroke="none"`. Add icons here, keep the grid.

const F = 'fill="currentColor" stroke="none"';

/** Gear, generated so the teeth are perfectly even. */
function gear(teeth = 8, ro = 7.4, ri = 5.6): string {
  const step = (Math.PI * 2) / teeth;
  const p = (r: number, a: number) => `${(10 + r * Math.cos(a)).toFixed(2)} ${(10 + r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'A' + ri + ' ' + ri + ' 0 0 1 '}${p(ri, a - 0.3)} L${p(ro, a - 0.17)} A${ro} ${ro} 0 0 1 ${p(ro, a + 0.17)} L${p(ri, a + 0.3)} `;
  }
  d += `A${ri} ${ri} 0 0 1 ${p(ri, -Math.PI / 2 - 0.3)}Z`;
  return `<path d="${d}"/><circle cx="10" cy="10" r="2.4"/>`;
}

const book = '<path d="M5 15.5V4.5A2.5 2.5 0 0 1 7.5 2h8v11.5H7a2 2 0 0 0 0 4h8.5"/>';
const search = '<circle cx="8.75" cy="8.75" r="5.25"/><path d="m12.75 12.75 4 4"/>';
const command = '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5"/><path d="m6.5 8 2 2-2 2M10.75 12h3"/>';
const bookmarkPath = 'M5.5 3.75a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1V17l-4.5-3.25L5.5 17z';
const typography = '<path d="m2.5 16 4.25-11.5L11 16M4.1 12h5.3"/><path d="m11.75 16 2.75-7.5 2.75 7.5M12.7 13.5h3.6"/>';
const circle7 = '<circle cx="10" cy="10" r="7"/>';

export const icons = {
  // app + navigation
  library:
    '<rect x="3" y="3" width="3.5" height="14" rx=".8"/><rect x="8" y="5" width="3.5" height="12" rx=".8"/><rect x="13.4" y="4.2" width="3.5" height="12.5" rx=".8" transform="rotate(-12 15.15 10.45)"/>',
  book,
  'book-open':
    '<path d="M10 5.5C8.6 4.3 6.5 3.75 3 3.75v11.5c3.5 0 5.6.55 7 1.75 1.4-1.2 3.5-1.75 7-1.75V3.75c-3.5 0-5.6.55-7 1.75z"/><path d="M10 5.5V17"/>',
  open: '<path d="M2.75 15.5V5A1.25 1.25 0 0 1 4 3.75h3.2l1.8 2h6A1.25 1.25 0 0 1 16.25 7v1.25"/><path d="M2.75 15.5 5 9.6a1.25 1.25 0 0 1 1.17-.85h10.6a.9.9 0 0 1 .84 1.22L15.6 15.5z"/>',
  folder: '<path d="M2.75 6A1.25 1.25 0 0 1 4 4.75h3.4l1.8 2H16A1.25 1.25 0 0 1 17.25 8v7A1.25 1.25 0 0 1 16 16.25H4A1.25 1.25 0 0 1 2.75 15z"/>',
  collection: '<path d="M10 3 17 6.75 10 10.5 3 6.75z"/><path d="m3 10.25 7 3.75 7-3.75M3 13.75l7 3.75 7-3.75"/>',
  search,
  command,
  palette: command,
  settings: gear(),
  close: '<path d="m5 5 10 10M15 5 5 15"/>',
  minimize: '<path d="M4.5 10h11"/>',
  maximize: '<rect x="4.5" y="4.5" width="11" height="11" rx="1.5"/>',
  restore: '<rect x="4.5" y="6.5" width="9" height="9" rx="1.5"/><path d="M7 4.5h6.5a2 2 0 0 1 2 2V13"/>',
  fullscreen: '<path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4"/>',
  'fullscreen-exit': '<path d="M7.5 3.5v4h-4M16.5 7.5h-4v-4M12.5 16.5v-4h4M3.5 12.5h4v4"/>',
  back: '<path d="M16 10H4.5M9 5 4 10l5 5"/>',
  forward: '<path d="M4 10h11.5M11 5l5 5-5 5"/>',
  'chevron-left': '<path d="m12 4.5-5.5 5.5 5.5 5.5"/>',
  'chevron-right': '<path d="m8 4.5 5.5 5.5L8 15.5"/>',
  'chevron-up': '<path d="M4.5 12.5 10 7l5.5 5.5"/>',
  'chevron-down': '<path d="M4.5 7.5 10 13l5.5-5.5"/>',
  history: '<path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6"/><path d="M3.25 3.25v3h3"/><path d="M10 6.75V10l2.25 1.5"/>',
  clock: `${circle7}<path d="M10 6v4l2.5 1.5"/>`,
  hash: '<path d="M7.75 3.5 6.25 16.5M13.75 3.5l-1.5 13M3.75 7.5h12.5M3.25 12.5h12.5"/>',

  // layout + views
  toc: '<path d="M3.5 4.75h13M3.5 8.25h9M7 11.75h9.5M7 15.25h6.5"/>',
  list: '<path d="M3.5 5h.01M3.5 10h.01M3.5 15h.01M7.25 5h9.25M7.25 10h9.25M7.25 15h9.25"/>',
  grid: '<rect x="3.25" y="3.25" width="5.5" height="5.5" rx="1.25"/><rect x="11.25" y="3.25" width="5.5" height="5.5" rx="1.25"/><rect x="3.25" y="11.25" width="5.5" height="5.5" rx="1.25"/><rect x="11.25" y="11.25" width="5.5" height="5.5" rx="1.25"/>',
  thumbnails: '<rect x="5.25" y="2.75" width="9.5" height="6" rx="1.25"/><rect x="5.25" y="11.25" width="9.5" height="6" rx="1.25"/>',
  sidebar: '<rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2"/><path d="M7.75 3.25v13.5M4.75 6.5h1M4.75 9h1"/>',
  page: '<rect x="5" y="2.75" width="10" height="14.5" rx="1.5"/><path d="M7.75 6.5h4.5M7.75 9.5h4.5M7.75 12.5h2.5"/>',
  spread: '<rect x="2.75" y="4" width="14.5" height="12" rx="1.5"/><path d="M10 4v12"/>',
  scroll: '<path d="M5 2.75v3.5a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 15 6.25v-3.5M5 17.25v-3.5a1.5 1.5 0 0 1 1.5-1.5h7a1.5 1.5 0 0 1 1.5 1.5v3.5"/>',
  paginate: '<rect x="3.25" y="2.75" width="10" height="14.5" rx="1.5"/><path d="m15.75 7.75 2.25 2.25-2.25 2.25"/>',
  'zoom-in': `${search}<path d="M6.5 8.75h4.5M8.75 6.5V11"/>`,
  'zoom-out': `${search}<path d="M6.5 8.75h4.5"/>`,
  'fit-width': '<path d="M2.75 4v12M17.25 4v12"/><path d="M6 10h8M8 7.5 5.5 10 8 12.5M12 7.5l2.5 2.5-2.5 2.5"/>',
  'fit-page': '<rect x="5" y="2.75" width="10" height="14.5" rx="1.5"/><path d="M10 6.25v7.5M8 8.25l2-2 2 2M8 11.75l2 2 2-2"/>',
  rotate: '<path d="M15.75 10.5a5.75 5.75 0 1 1-2.88-4.98"/><path d="M10.4 5.9 12.9 5.5 12 3.1"/>',
  rtl: '<path d="M16.5 15H5.5M7.75 12.75 5.5 15l2.25 2.25"/><path d="M10 3.5H8.25a2.5 2.5 0 0 0 0 5H10M10 3.5V11M13 3.5V11M9.5 3.5h4.5"/>',
  image: '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2"/><circle cx="7.25" cy="8" r="1.25"/><path d="m3 14 4-3.75 3 2.5 3-3 4.25 4"/>',
  comic: '<rect x="2.75" y="2.75" width="14.5" height="14.5" rx="2"/><path d="M2.75 9.5h14.5M10.75 2.75V9.5M7.5 9.5v7.75"/>',

  // reading tools
  bookmark: `<path d="${bookmarkPath}"/>`,
  'bookmark-filled': `<path d="${bookmarkPath}" fill="currentColor"/>`,
  highlight: '<path d="m11.9 3.6 4.5 4.5-7.4 7.4H4.5V11z"/><path d="m10.4 5.1 4.5 4.5"/><path d="M3 18h6.5" opacity=".5"/>',
  note: '<path d="M16.25 11.5V4.75a1 1 0 0 0-1-1H4.75a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h6.75z"/><path d="M11.5 16.25V12.5a1 1 0 0 1 1-1h3.75M6.75 7.25h6.5M6.75 10.25h3"/>',
  annotations: '<path d="M3.75 5h8.5M3.75 9h8.5M3.75 13h4.25"/><path d="m14.6 9.4 2 2-5.1 5.1H9.5v-2z"/>',
  quote: '<path d="M4 9.5h3.5V13A2.5 2.5 0 0 1 5 15.5M4 9.5V7a2.5 2.5 0 0 1 2.5-2.5M11.25 9.5h3.5V13a2.5 2.5 0 0 1-2.5 2.5M11.25 9.5V7a2.5 2.5 0 0 1 2.5-2.5"/>',
  theme: `${circle7}<path d="M10 3a7 7 0 0 1 0 14z" ${F}/>`,
  sun: '<circle cx="10" cy="10" r="3.25"/><path d="M10 2.5V4M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.06 1.06M14.24 14.24l1.06 1.06M4.7 15.3l1.06-1.06M14.24 5.76l1.06-1.06"/>',
  moon: '<path d="M16.5 12.2A6.75 6.75 0 0 1 7.8 3.5a6.75 6.75 0 1 0 8.7 8.7z"/>',
  tint: '<path d="M10 2.75s5.25 5.4 5.25 9a5.25 5.25 0 0 1-10.5 0c0-3.6 5.25-9 5.25-9z"/><path d="M10 14.75a3 3 0 0 1-3-3"/>',
  typography,
  'text-size': typography,
  focus: '<path d="M3.25 7V4.25a1 1 0 0 1 1-1H7M13 3.25h2.75a1 1 0 0 1 1 1V7M16.75 13v2.75a1 1 0 0 1-1 1H13M7 16.75H4.25a1 1 0 0 1-1-1V13"/><circle cx="10" cy="10" r="2.25"/>',
  ruler: '<path d="M3 4.5h14M3 15.5h14" opacity=".45"/><rect x="2.75" y="8" width="14.5" height="4" rx="1"/>',
  'auto-scroll': '<path d="M6.5 5 10 8.5 13.5 5M6.5 11 10 14.5l3.5-3.5"/>',
  play: '<path d="M6.5 4.6v10.8a.6.6 0 0 0 .92.5l8.3-5.4a.6.6 0 0 0 0-1L7.42 4.1a.6.6 0 0 0-.92.5z"/>',
  pause: '<rect x="5.75" y="4.25" width="2.75" height="11.5" rx=".75"/><rect x="11.5" y="4.25" width="2.75" height="11.5" rx=".75"/>',
  'skip-back': '<path d="M5.25 4.5v11"/><path d="M15.5 5.2v9.6a.6.6 0 0 1-.94.5l-6.9-4.8a.6.6 0 0 1 0-1l6.9-4.8a.6.6 0 0 1 .94.5z"/>',
  'skip-forward': '<path d="M14.75 4.5v11"/><path d="M4.5 5.2v9.6a.6.6 0 0 0 .94.5l6.9-4.8a.6.6 0 0 0 0-1l-6.9-4.8a.6.6 0 0 0-.94.5z"/>',
  speaker: '<path d="M3.75 7.75v4.5h2.75l4 3.5V4.25l-4 3.5z"/><path d="M13.25 7.5a3.5 3.5 0 0 1 0 5M15.5 5.25a6.75 6.75 0 0 1 0 9.5"/>',
  dictionary: '<path d="M4.75 15.5V4.25a1.5 1.5 0 0 1 1.5-1.5h9v11.5H6.5a1.75 1.75 0 0 0 0 3.5h8.75"/><path d="m8 11 2-5.25L12 11M8.6 9.4h2.8"/>',
  globe: `${circle7}<path d="M3 10h14M10 3c-2.2 2-3 4.4-3 7s.8 5 3 7c2.2-2 3-4.4 3-7s-.8-5-3-7z"/>`,

  // actions
  more: `<circle cx="4.75" cy="10" r="1.15" ${F}/><circle cx="10" cy="10" r="1.15" ${F}/><circle cx="15.25" cy="10" r="1.15" ${F}/>`,
  'more-vertical': `<circle cx="10" cy="4.75" r="1.15" ${F}/><circle cx="10" cy="10" r="1.15" ${F}/><circle cx="10" cy="15.25" r="1.15" ${F}/>`,
  check: '<path d="m4.5 10.5 3.5 3.5 7.5-8"/>',
  plus: '<path d="M10 4.25v11.5M4.25 10h11.5"/>',
  minus: '<path d="M4.25 10h11.5"/>',
  clear: `${circle7}<path d="m7.6 7.6 4.8 4.8M12.4 7.6l-4.8 4.8"/>`,
  trash: '<path d="M3.75 5.5h12.5M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5.25 5.5l.7 10.1a1.5 1.5 0 0 0 1.5 1.4h5.1a1.5 1.5 0 0 0 1.5-1.4l.7-10.1M8.5 8.75v5M11.5 8.75v5"/>',
  edit: '<path d="M12.6 3.9a1.6 1.6 0 0 1 2.26 0l1.24 1.24a1.6 1.6 0 0 1 0 2.26L7.5 16H4v-3.5z"/><path d="m11.25 5.25 3.5 3.5"/>',
  filter: '<path d="M3.5 5.5h13M6 10h8M8.5 14.5h3"/>',
  sort: '<path d="M6 4v12M3.5 13.5 6 16l2.5-2.5M14 16V4M11.5 6.5 14 4l2.5 2.5"/>',
  export: '<path d="M10 12.5V3.25M6.5 6.75 10 3.25l3.5 3.5"/><path d="M4 11v4.25a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V11"/>',
  import: '<path d="M10 3.25v9.25M6.5 9 10 12.5 13.5 9"/><path d="M4 11v4.25a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5V11"/>',
  copy: '<rect x="7" y="7" width="9.75" height="9.75" rx="1.75"/><path d="M13 7V4.75a1.5 1.5 0 0 0-1.5-1.5H4.75a1.5 1.5 0 0 0-1.5 1.5v6.75A1.5 1.5 0 0 0 4.75 13H7"/>',
  link: '<path d="M8.5 11.5a3 3 0 0 0 4.24 0l2.6-2.6a3 3 0 0 0-4.24-4.24l-.9.9"/><path d="M11.5 8.5a3 3 0 0 0-4.24 0l-2.6 2.6a3 3 0 0 0 4.24 4.24l.9-.9"/>',
  undo: '<path d="M5.5 8.25h7a3.75 3.75 0 0 1 0 7.5H9.5"/><path d="M8 5.25 5 8.25l3 3"/>',
  redo: '<path d="M14.5 8.25h-7a3.75 3.75 0 0 0 0 7.5h3"/><path d="m12 5.25 3 3-3 3"/>',

  // status
  warning: '<path d="M8.7 3.6a1.5 1.5 0 0 1 2.6 0l6 10.6a1.5 1.5 0 0 1-1.3 2.25H4a1.5 1.5 0 0 1-1.3-2.25z"/><path d="M10 7.75v3.5M10 13.9v.1"/>',
  info: `${circle7}<path d="M10 9.25v4.25M10 6.5v.1"/>`,
  error: `${circle7}<path d="M10 6.25v4.5M10 13.5v.1"/>`,
  'check-circle': `${circle7}<path d="m7 10.25 2 2 4-4.5"/>`,
  lock: '<rect x="4.25" y="8.75" width="11.5" height="8.25" rx="1.75"/><path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25"/>',
  keyboard: '<rect x="2.25" y="5" width="15.5" height="10" rx="2"/><path d="M5.5 8.25h.01M8.5 8.25h.01M11.5 8.25h.01M14.5 8.25h.01M6.5 11.75h7"/>',
} as const satisfies Record<string, string>;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];
