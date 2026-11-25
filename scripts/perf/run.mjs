// `npm run perf [-- --web | --app | --runs N --settle SECONDS]`: timings against the SPEC performance budget.
// Warns, never fails: a slow or busy machine is noise, not a regression (SPEC, "Performance checks").
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { measureApp } from './app.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const only = args.includes('--web') ? 'web' : args.includes('--app') ? 'app' : 'both';
const opt = (n, d) => (args.includes(n) ? Number(args[args.indexOf(n) + 1]) : d);

const rows = [];
const add = (what, got, budget, unit, note = '') => rows.push({ what, got, budget, unit, note });

if (only !== 'app') {
  console.log('web layer (Playwright, production build)…');
  execSync('npx playwright test -c playwright.perf.config.ts', { cwd: root, stdio: 'inherit' });
  const w = JSON.parse(readFileSync(join(root, 'test-results/perf-web.json'), 'utf8'));
  add('web: library first-interactive', w.libraryInteractiveMs, 800, 'ms');
  add('web: first page, 2,000-page PDF', w.bigPdfFirstPageMs, 400, 'ms');
  add('web: first page, 600 MB PDF', w.largePdfFirstPageMs, 400, 'ms');
  add('web: EPUB page turn (median)', w.epubPageTurnMs, 50, 'ms');
  add('web: comic page turn (median, cached)', w.comicPageTurnMs, 50, 'ms');
  add('web: long tasks while scrolling', w.scrollLongTasks, 0, '', `longest ${Math.round(w.scrollLongestTaskMs)} ms`);
}
let app;
if (only !== 'web') {
  console.log('real app (release exe)…');
  app = await measureApp({ runs: opt('--runs', 5), settleMs: opt('--settle', 30) * 1000, log: (m) => console.log('  ' + m) });
  add('app: cold start to interactive library', app.coldStartMs, 800, 'ms', `runs ${app.coldStartRuns.map(Math.round).join('/')}`);
  add('app: first page, 2,000-page PDF', app.pdfFirstPageMs, 400, 'ms', `${Math.round(app.pdfFirstPageFromLaunchMs)} ms from process launch`);
  const m = app.memory_epub;
  add('app: idle memory, EPUB open (private WS)', m.privateMB, 150, 'MB', `sum of working sets ${m.workingSetMB} MB, ${m.processes} processes`);
  const p = app.memory_pdf;
  add('app: idle memory, PDF open (private WS)', p.privateMB, 150, 'MB', `sum of working sets ${p.workingSetMB} MB, ${p.processes} processes`);
  const installer = join(root, 'src-tauri/target/release/bundle/nsis/Quire_0.1.0_x64-setup.exe');
  if (existsSync(installer)) add('installer size (incl. dictionary)', +(statSync(installer).size / 1048576).toFixed(1), 20, 'MB');
  mkdirSync(join(root, 'test-results'), { recursive: true });
  writeFileSync(join(root, 'test-results/perf-app.json'), JSON.stringify(app, null, 2));
}

const f = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const w0 = Math.max(...rows.map((r) => r.what.length));
console.log(`\n${'measure'.padEnd(w0)}  ${'got'.padStart(8)}  ${'budget'.padStart(8)}  status  notes`);
for (const r of rows) {
  const ok = r.budget === 0 ? r.got === 0 : r.got < r.budget;
  console.log(`${r.what.padEnd(w0)}  ${(f(r.got) + ' ' + r.unit).padStart(8)}  ${('< ' + r.budget + ' ' + r.unit).padStart(8)}  ${ok ? 'ok    ' : 'WARN  '}  ${r.note}`);
}
if (rows.some((r) => (r.budget === 0 ? r.got !== 0 : r.got >= r.budget))) console.log('\nWARN: some lines are over budget (timings are machine-dependent; this does not fail the run).');
