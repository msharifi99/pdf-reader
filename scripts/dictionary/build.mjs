// Builds src-tauri/resources/dictionary.sqlite from WordNet 3.1 (`wordnet-db`) + the 3.0 exception
// lists (`wndb-with-exceptions`, the only npm package that ships the *.exc files).
//   npm run build:dictionary
// Schema (see src-tauri/src/dictionary.rs):
//   lemma(key PK, word, f, s)  key = folded form ("ice cream"); word = display form when it differs
//                              (proper nouns); f = corpus frequency; s = "id,id,..." senses, n/v/a/r order
//   synset(id PK, pos, def, ex, syn)   ex = examples joined by \n; syn = lemma display forms joined by |
//   exc(form, pos, base)       irregular inflections
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dict = join(dirname(require.resolve('wordnet-db/package.json')), 'dict');
const excDir = join(dirname(require.resolve('wndb-with-exceptions/package.json')), 'data');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src-tauri', 'resources', 'dictionary.sqlite');

const POS = { noun: 'n', verb: 'v', adj: 'a', adv: 'r' };
const SS_POS = { n: 'n', v: 'v', a: 'a', s: 'a', r: 'r' };
const read = (p) => readFileSync(p, 'utf8').split('\n').filter((l) => l && !l.startsWith('  '));

export const fold = (s) =>
  s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[_\s\-‐-―]+/g, ' ').trim();

// 1. synsets
const synsets = new Map(); // `${pos}${offset}` -> {id, pos, def, ex, words}
const display = new Map(); // key -> capitalised display form
let nextId = 1;
for (const [file, pos] of Object.entries(POS)) {
  for (const line of read(join(dict, `data.${file}`))) {
    const bar = line.indexOf(' | ');
    const f = line.slice(0, bar).split(' ');
    const gloss = line.slice(bar + 3).trim();
    const wc = parseInt(f[3], 16);
    const words = [];
    for (let i = 0; i < wc; i++) words.push(f[4 + i * 2].replace(/\(\w+\)$/, '').replace(/_/g, ' '));
    const q = gloss.search(/; "/);
    const def = (q < 0 ? gloss : gloss.slice(0, q)).trim();
    const ex = q < 0 ? [] : [...gloss.slice(q).matchAll(/"([^"]*)"/g)].map((m) => m[1].trim()).filter(Boolean);
    for (const w of words) {
      const k = fold(w);
      if (!display.has(k) && /\p{Lu}/u.test(w)) display.set(k, w);
    }
    synsets.set(pos + f[0], { id: nextId++, pos, def, ex: ex.join('\n'), words });
  }
}

// 2. frequency per lemma
const freq = new Map();
for (const line of read(join(dict, 'index.sense'))) {
  const sp = line.split(' ');
  const k = fold(sp[0].split('%')[0]);
  freq.set(k, (freq.get(k) ?? 0) + (parseInt(sp[3], 10) || 0));
}

// 3. lemmas: senses in n, v, a, r order, each in WordNet's frequency rank order
const lemmas = new Map(); // key -> number[] synset ids
for (const [file, pos] of Object.entries(POS)) {
  for (const line of read(join(dict, `index.${file}`))) {
    const f = line.split(' ');
    const pc = parseInt(f[3], 10);
    const offsets = f.slice(6 + pc, 6 + pc + parseInt(f[2], 10));
    const key = fold(f[0]);
    const ids = offsets.map((o) => synsets.get(pos + o)?.id).filter(Boolean);
    lemmas.set(key, [...(lemmas.get(key) ?? []), ...ids]);
  }
}

mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });
const db = new DatabaseSync(out);
db.exec(`PRAGMA page_size=4096; PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
CREATE TABLE lemma(key TEXT PRIMARY KEY, word TEXT, f INTEGER NOT NULL, s TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE synset(id INTEGER PRIMARY KEY, pos TEXT NOT NULL, def TEXT NOT NULL, ex TEXT, syn TEXT);
CREATE TABLE exc(form TEXT NOT NULL, pos TEXT NOT NULL, base TEXT NOT NULL, PRIMARY KEY(form, pos, base)) WITHOUT ROWID;
BEGIN;`);
const insS = db.prepare('INSERT INTO synset VALUES (?,?,?,?,?)');
for (const s of synsets.values()) insS.run(s.id, s.pos, s.def, s.ex || null, s.words.length > 1 ? s.words.join('|') : null);
// syn holds every member, so the synonyms of a lemma are syn minus the lemma itself.
const insL = db.prepare('INSERT INTO lemma VALUES (?,?,?,?)');
for (const [key, ids] of lemmas) {
  const w = display.get(key);
  insL.run(key, w && w !== key ? w : null, freq.get(key) ?? 0, ids.join(','));
}
const insE = db.prepare('INSERT OR IGNORE INTO exc VALUES (?,?,?)');
let excCount = 0;
for (const [file, pos] of Object.entries(POS)) {
  for (const line of read(join(excDir, `${file}.exc`))) {
    const [form, ...bases] = line.trim().split(/\s+/);
    for (const b of bases) if (lemmas.has(fold(b))) (insE.run(fold(form), pos, fold(b)), excCount++);
  }
}
db.exec('COMMIT; ANALYZE; VACUUM;');
db.close();
console.log(`dictionary.sqlite: ${lemmas.size} lemmas, ${synsets.size} synsets, ${excCount} exceptions, ${(statSync(out).size / 1048576).toFixed(1)} MB`);
