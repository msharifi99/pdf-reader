// Real-app timings: launches the release exe with QUIRE_PERF=1 and reads its timestamp log.
// Runs against a throw-away APPDATA/LOCALAPPDATA, so the user's library and settings are never touched.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export const exePath = () => process.env.QUIRE_EXE ?? join(root, 'src-tauri/target/release/quire.exe');
const fx = (p) => join(root, 'public/fixtures', p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ps = (script) => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 1 << 24 }).trim();

/** Private working set + working set (MB) of a process and every descendant (quire.exe plus its WebView2 processes). */
export function treeMemory(pid) {
  const script = `
    $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
    $ids = [System.Collections.Generic.List[int]]::new(); $ids.Add(${pid})
    for ($i = 0; $i -lt $ids.Count; $i++) { foreach ($p in $all) { if ($p.ParentProcessId -eq $ids[$i] -and -not $ids.Contains([int]$p.ProcessId)) { $ids.Add([int]$p.ProcessId) } } }
    $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids.Contains([int]$_.IDProcess) }
    $rows = $perf | ForEach-Object { [pscustomobject]@{ name = $_.Name; pid = [int]$_.IDProcess; priv = [double]$_.WorkingSetPrivate; ws = [double]$_.WorkingSet } }
    @{ rows = @($rows) } | ConvertTo-Json -Depth 4 -Compress`;
  const rows = JSON.parse(ps(script)).rows;
  const mb = (k) => rows.reduce((s, r) => s + r[k], 0) / 1048576;
  return { privateMB: mb('priv'), workingSetMB: mb('ws'), processes: rows.length, rows };
}

function killTree(child) {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
}

/** Launch, wait for `until` (a mark name) and return marks in ms since spawn. `keep` leaves the app running. */
async function launch(sandbox, args, until, { keep = false, timeout = 30_000 } = {}) {
  const log = join(sandbox.dir, `perf-${sandbox.n++}.log`);
  const t0 = Date.now();
  const child = spawn(exePath(), args, {
    env: { ...process.env, APPDATA: sandbox.roaming, LOCALAPPDATA: sandbox.local, QUIRE_PERF: '1', QUIRE_STARTUP_LOG: log },
    stdio: 'ignore',
    detached: false,
  });
  const marks = {};
  const read = () => {
    if (!existsSync(log)) return;
    for (const line of readFileSync(log, 'utf8').split('\n')) {
      const m = /^(\d+) pid=\d+ (\S+)(?: at=(\d+))?/.exec(line);
      if (m) marks[m[2]] ??= Number(m[3] ?? m[1]) - t0;
    }
  };
  while (Date.now() - t0 < timeout) {
    read();
    if (marks[until] !== undefined) break;
    await sleep(15);
  }
  read();
  if (marks[until] === undefined) { killTree(child); throw new Error(`no "${until}" mark within ${timeout} ms (got ${Object.keys(marks).join(', ')})`); }
  if (!keep) { killTree(child); await sleep(400); }
  return { marks, child };
}

export async function measureApp({ runs = 5, settleMs = 30_000, parts = ['cold', 'pdf', 'memory'], log = console.log } = {}) {
  const exe = exePath();
  if (!existsSync(exe)) throw new Error(`${exe} not found: run \`npm run tauri build\` first`);
  if (ps(`(Get-Process quire -ErrorAction SilentlyContinue | Measure-Object).Count`) !== '0') throw new Error('Quire is already running; close it first (single-instance would route the launch to it)');
  const dir = mkdtempSync(join(tmpdir(), 'quire-perf-'));
  const sandbox = { dir, roaming: join(dir, 'roaming'), local: join(dir, 'local'), n: 0 };
  const out = { exe, size: statSync(exe).size };
  try {
    // warm-up: creates the profile, registers three books, primes the disk cache
    log('warm-up…');
    await launch(sandbox, [fx('pdf/big.pdf'), fx('reflow/epub3.epub'), fx('comic/comic.cbz')], 'web:first-page');
    if (parts.includes('cold')) {
    log(`cold start x${runs}…`);
    const cold = [], phases = [];
    for (let i = 0; i < runs; i++) {
      const { marks } = await launch(sandbox, [], 'web:library-interactive');
      cold.push(marks['web:library-interactive']);
      phases.push(marks);
    }
    out.coldStartMs = median(cold);
    out.coldStartRuns = cold;
    const mid = phases.find((p) => p['web:library-interactive'] === out.coldStartMs) ?? phases[0];
    out.phases = Object.fromEntries(Object.entries(mid).map(([k, v]) => [k.replace('web:', ''), Math.round(v)]));
    }
    if (parts.includes('pdf')) {
    log(`first page of the 2,000-page PDF x${runs}…`);
    const total = [], engine = [];
    for (let i = 0; i < runs; i++) {
      const { marks } = await launch(sandbox, [fx('pdf/big.pdf')], 'web:first-page');
      total.push(marks['web:first-page']);
      engine.push(marks['web:first-page'] - marks['web:open-start']);
    }
    out.pdfFirstPageMs = median(engine);
    out.pdfFirstPageFromLaunchMs = median(total);
    }
    if (parts.includes('memory')) for (const [name, file] of [['epub', 'reflow/epub3.epub'], ['pdf', 'pdf/big.pdf']]) {
      log(`idle memory with a ${name} open (${settleMs / 1000} s)…`);
      const { child } = await launch(sandbox, [fx(file)], 'web:first-page', { keep: true });
      await sleep(settleMs);
      const m = treeMemory(child.pid);
      out[`memory_${name}`] = { privateMB: Math.round(m.privateMB), workingSetMB: Math.round(m.workingSetMB), processes: m.processes, rows: m.rows.map((r) => `${r.name}:${Math.round(r.priv / 1048576)}`) };
      killTree(child);
      await sleep(500);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

if (process.argv[1]?.endsWith('app.mjs')) {
  const only = process.argv[2];
  console.log(JSON.stringify(await measureApp({ parts: only ? [only] : undefined, settleMs: Number(process.env.SETTLE ?? 30) * 1000 }), null, 2));
}
