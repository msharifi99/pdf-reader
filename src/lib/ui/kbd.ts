// Shortcut string -> display keys. "Ctrl+Shift+K" -> [["Ctrl","Shift","K"]]; "g g" -> [["g"],["g"]].

const NAMES: Record<string, string> = {
  control: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', meta: 'Win', win: 'Win', cmd: 'Win',
  arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', left: '←', right: '→', up: '↑', down: '↓',
  escape: 'Esc', esc: 'Esc', enter: 'Enter', return: 'Enter', space: 'Space', ' ': 'Space', tab: 'Tab',
  backspace: 'Backspace', delete: 'Del', del: 'Del', pageup: 'PgUp', pagedown: 'PgDn', home: 'Home', end: 'End',
  insert: 'Ins', plus: '+', minus: '−', comma: ',', period: '.', slash: '/', backquote: '`',
};

function pretty(key: string, inChord: boolean): string {
  const named = NAMES[key.toLowerCase()];
  if (named) return named;
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  // single letters keep their case in sequences (vim-style g vs G); in a chord, show caps
  if (key.length === 1) return inChord ? key.toUpperCase() : key;
  return key[0]!.toUpperCase() + key.slice(1);
}

export function parseShortcut(shortcut: string): string[][] {
  return shortcut
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => {
      // "Ctrl++" -> ["Ctrl", "+"]; split on + that is followed by something
      const parts = step.length > 1 ? step.split(/\+(?=.)/) : [step];
      return parts.map((p) => pretty(p, parts.length > 1));
    });
}
