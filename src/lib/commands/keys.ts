/**
 * Key normalisation, parsing and formatting.
 *
 * Canonical step format: modifiers in the order `Ctrl+Alt+Shift+Meta+` followed by a key token.
 *  - Letters: bare => lowercase ("g"); with ANY modifier (incl. Shift) => uppercase ("Shift+G", "Ctrl+K").
 *    So `g g` (two presses of g) and `G` (= "Shift+G") are distinct and both bindable.
 *    The bare string "G" parses as "Shift+G". Labels show "g" and "G" respectively.
 *  - Symbols already encode Shift, so it is dropped: "?" (not "Shift+?"), Ctrl+Shift+= => "Ctrl+Plus".
 *    "+" is spelled "Plus". Ctrl+= stays "Ctrl+=" (bind both for zoom in).
 *  - Named keys: Left Right Up Down Enter Escape Tab Backspace Delete Insert Home End PageUp PageDown
 *    Space F1..F24. Shift is kept for these ("Shift+Space").
 *  - Numpad keys map onto their printable/named equivalent (NumpadAdd => Plus).
 *  - Layout-aware: uses event.key; falls back to event.code when Ctrl/Alt/Meta make key unusable
 *    (non-Latin layouts, dead keys). AltGr (reported as Ctrl+Alt on Windows) is not treated as Ctrl/Alt.
 * A sequence is steps joined by one space: "g g", "Ctrl+K Ctrl+C".
 */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  getModifierState?(k: string): boolean;
}

const MODIFIER_KEYS = new Set([
  'Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS', 'Hyper', 'Super', 'Fn', 'FnLock', 'Symbol', 'SymbolLock'
]);

const NAMED: Record<string, string> = {
  arrowleft: 'Left', left: 'Left', arrowright: 'Right', right: 'Right', arrowup: 'Up', up: 'Up', arrowdown: 'Down', down: 'Down',
  escape: 'Escape', esc: 'Escape', enter: 'Enter', return: 'Enter', tab: 'Tab', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', insert: 'Insert', ins: 'Insert', home: 'Home', end: 'End',
  pageup: 'PageUp', pgup: 'PageUp', pagedown: 'PageDown', pgdn: 'PageDown', pgdown: 'PageDown',
  space: 'Space', spacebar: 'Space', plus: 'Plus', contextmenu: 'ContextMenu', pause: 'Pause', printscreen: 'PrintScreen'
};
const MODS: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift', meta: 'meta', win: 'meta', windows: 'meta', cmd: 'meta', super: 'meta'
};

const NUMPAD: Record<string, string> = {
  NumpadAdd: 'Plus', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.', NumpadEnter: 'Enter', NumpadComma: ','
};
const CODE_CHARS: Record<string, string> = {
  Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`', Space: 'Space', IntlBackslash: '\\'
};

const isLetter = (c: string) => /^\p{L}$/u.test(c);
const isDigit = (c: string) => /^[0-9]$/.test(c);
const isSingle = (s: string) => [...s].length === 1;

interface Parts {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

function build(p: Parts): string {
  let { shift } = p;
  let key = p.key;
  if (key === ' ') key = 'Space';
  if (key === '+') key = 'Plus';
  if (isSingle(key)) {
    if (isLetter(key)) key = p.ctrl || p.alt || shift || p.meta ? key.toUpperCase() : key.toLowerCase();
    else if (!isDigit(key)) shift = false; // symbol character already encodes Shift
  } else if (key === 'Plus') shift = false;
  return [p.ctrl && 'Ctrl', p.alt && 'Alt', shift && 'Shift', p.meta && 'Meta', key].filter(Boolean).join('+');
}

function keyFromCode(code: string | undefined): string | null {
  if (!code) return null;
  if (NUMPAD[code]) return NUMPAD[code];
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1]!.toLowerCase();
  m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (m) return m[1]!;
  return CODE_CHARS[code] ?? null;
}

/** KeyboardEvent -> canonical step, or null for modifier-only / unusable events. */
export function normalizeEvent(e: KeyLike): string | null {
  let key = e.key;
  if (MODIFIER_KEYS.has(key)) return null;
  const altGr = !!e.getModifierState?.('AltGraph');
  const ctrl = !!e.ctrlKey && !altGr;
  const alt = !!e.altKey && !altGr;
  const meta = !!e.metaKey;
  const shift = !!e.shiftKey;

  if (e.code && NUMPAD[e.code]) key = NUMPAD[e.code]!;
  else if (isSingle(key)) {
    const cp = key.codePointAt(0)!;
    const unusable = cp < 32 || ((ctrl || alt || meta) && cp > 127);
    if (unusable) key = keyFromCode(e.code) ?? key;
  } else if (key === 'Dead' || key === 'Unidentified' || key === 'Process') {
    const k = keyFromCode(e.code);
    if (!k) return null;
    key = k;
  } else {
    const named = NAMED[key.toLowerCase()];
    if (named) key = named;
    else if (!/^F([1-9]|1\d|2[0-4])$/.test(key)) return null;
  }
  return build({ ctrl, alt, shift, meta, key });
}

/** Parse a user/data-written step ("ctrl+shift+k", "G", "Ctrl++", "Esc") into canonical form; null if invalid. */
export function parseStep(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  let mods: string[];
  let key: string;
  if (s === '+') {
    mods = [];
    key = '+';
  } else if (s.endsWith('+')) {
    key = '+';
    mods = s.slice(0, -1).split('+').filter(Boolean);
  } else {
    const parts = s.split('+');
    key = parts.pop()!;
    mods = parts;
  }

  const p: Parts = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (const m of mods) {
    const k = MODS[m.toLowerCase()];
    if (!k) return null;
    p[k] = true;
  }
  const named = NAMED[key.toLowerCase()];
  if (named) p.key = named;
  else if (/^f([1-9]|1\d|2[0-4])$/i.test(key)) p.key = key.toUpperCase();
  else if (isSingle(key)) {
    p.key = key;
    if (mods.length === 0 && isLetter(key) && key !== key.toLowerCase()) p.shift = true; // bare "G"
  } else return null;
  return build(p);
}

export function splitStep(step: string): Parts {
  const parts = step.split('+');
  const key = parts.pop()!;
  const out: Parts = { ctrl: false, alt: false, shift: false, meta: false, key };
  for (const m of parts) { const k = MODS[m.toLowerCase()]; if (k) out[k] = true; }
  return out;
}

/** "g g" -> ["g","g"]; null if any step is invalid or the sequence is empty. */
export function parseSequence(input: string): string[] | null {
  const raw = input.trim().split(/\s+/).filter(Boolean);
  if (!raw.length) return null;
  const out: string[] = [];
  for (const r of raw) {
    const s = parseStep(r);
    if (!s) return null;
    out.push(s);
  }
  return out;
}
export function normalizeSequence(input: string): string | null {
  return parseSequence(input)?.join(' ') ?? null;
}

const CAPS: Record<string, string> = {
  Left: '←', Right: '→', Up: '↑', Down: '↓', Escape: 'Esc', Plus: '+', Backspace: '⌫', Delete: 'Del', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins'
};

/** Key caps for rendering: "Ctrl+Shift+K" -> ["Ctrl","Shift","K"]; "Shift+G" -> ["G"]; "g" -> ["g"]; "Alt+Left" -> ["Alt","←"]. */
export function keyCaps(step: string): string[] {
  const p = splitStep(step);
  const caps: string[] = [];
  const letterShift = isSingle(p.key) && isLetter(p.key) && p.shift && !p.ctrl && !p.alt && !p.meta;
  if (p.ctrl) caps.push('Ctrl');
  if (p.alt) caps.push('Alt');
  if (p.shift && !letterShift) caps.push('Shift');
  if (p.meta) caps.push('Win');
  caps.push(CAPS[p.key] ?? p.key);
  return caps;
}
export const formatStep = (step: string): string => keyCaps(step).join('+');
/** "g g" -> "g g"; "Ctrl+K Ctrl+C" stays spaced. */
export const formatSequence = (seq: string | readonly string[]): string =>
  (typeof seq === 'string' ? seq.split(' ') : seq).map(formatStep).join(' ');
