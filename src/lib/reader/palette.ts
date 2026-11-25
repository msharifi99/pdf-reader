/** Palette modes while a book is open: `@` TOC, `#` go to page / % / chapter, `/` search in book. */
import { rankItems } from '../commands';
import type { SearchHit } from '../engines/types';
import { registerPaletteProvider, type PaletteItem } from '../shell/palette/providers.svelte';
import type { FindState } from './find.svelte';
import type { ReaderSession } from './session.svelte';

const pageLabel = (s: ReaderSession, i: number) => s.handle?.pageLabels?.[i] ?? String(i + 1);

function tocItems(s: ReaderSession, q: string, limit = 60): PaletteItem[] {
  const ranked = rankItems(s.flat, q, { fields: (t) => t.entry.title, limit });
  return ranked.map(({ item: t, indices }) => ({
    id: `toc-${t.index}`,
    title: t.entry.title,
    indices,
    icon: 'toc',
    detail: t.entry.locator.kind === 'fixed' ? `p. ${pageLabel(s, t.entry.locator.page)}` : `${Math.round(t.entry.locator.fraction * 100)}%`,
    run: () => s.jump(t.entry.locator),
  }));
}

export function registerReaderPalette(s: ReaderSession, find: FindState): () => void {
  const offs = [
    registerPaletteProvider({
      mode: 'toc',
      label: 'Contents',
      placeholder: 'Jump to a chapter',
      emptyText: 'No chapter by that name',
      query: (q) => tocItems(s, q.text),
    }),
    registerPaletteProvider({
      mode: 'goto',
      label: 'Go to',
      placeholder: 'A page number, a percentage like 40%, or a chapter',
      emptyText: 'Type a page number, a percentage, or part of a chapter title',
      query: (q) => {
        const items: PaletteItem[] = [];
        const h = s.handle;
        const count = h?.pageCount ?? s.location?.progress.location?.count ?? 0;
        const g = q.goto;
        if (g?.kind === 'percent') {
          items.push({ id: 'goto-pct', title: `Go to ${g.percent}%`, icon: 'hash', run: () => s.jump({ fraction: g.percent / 100 }) });
        } else if (g?.kind === 'page' && count) {
          const n = Math.min(count, g.page);
          if (h?.pageCount) {
            items.push({ id: 'goto-page', title: `Go to page ${n}`, detail: `of ${count}`, icon: 'hash', run: () => s.jump({ kind: 'fixed', page: n - 1, y: 0 }) });
          } else {
            items.push({ id: 'goto-loc', title: `Go to location ${n}`, detail: `of ${count}`, icon: 'hash', run: () => s.jump({ fraction: (n - 1) / Math.max(1, count) }) });
          }
        } else if (h?.pageLabels && q.text) {
          // printed page labels ("xiv", "A-3")
          const i = h.pageLabels.findIndex((l) => l.toLowerCase() === q.text.toLowerCase());
          if (i >= 0) items.push({ id: 'goto-label', title: `Go to page ${h.pageLabels[i]}`, icon: 'hash', run: () => s.jump({ kind: 'fixed', page: i, y: 0 }) });
        }
        if (q.text && !g) items.push(...tocItems(s, q.text, 20).map((t) => ({ ...t, group: 'Chapters' })));
        return items;
      },
    }),
    registerPaletteProvider({
      mode: 'search',
      label: 'In this book',
      placeholder: 'Search this book',
      emptyText: s.handle?.capabilities.search === false ? 'This book has no searchable text yet' : 'No matches',
      query: async (q, signal) => {
        const text = q.text.trim();
        const e = s.engine;
        if (text.length < 2 || !e || !s.handle?.capabilities.search) return [];
        await new Promise((r) => setTimeout(r, 120)); // typing: let the next keystroke abort us first
        if (signal.aborted) return [];
        const hits: SearchHit[] = [];
        try {
          for await (const hit of e.search(text, { signal })) {
            hits.push(hit);
            if (hits.length >= 40) break;
          }
        } catch {
          return [];
        }
        return hits.map((hit, i) => {
          const pre = hit.excerpt.before.slice(-40).trimStart();
          return {
          id: `hit-${i}`,
          title: `${pre}${hit.excerpt.match}${hit.excerpt.after.slice(0, 60)}`.trimEnd(),
          indices: range(pre.length, hit.excerpt.match.length),
          detail: hit.section ?? (hit.locator.kind === 'fixed' ? `p. ${pageLabel(s, hit.locator.page)}` : undefined),
          icon: 'search',
          // hand the query to the find bar so every hit stays highlighted and Enter keeps stepping
          run: async () => {
            find.show(text);
            await find.run(text, 0);
            const at = find.hits.findIndex((h) => JSON.stringify(h.locator) === JSON.stringify(hit.locator) && h.excerpt.before === hit.excerpt.before);
            await find.select(at >= 0 ? at : i);
          },
          };
        });
      },
    }),
  ];
  return () => offs.forEach((f) => f());
}

const range = (start: number, n: number) => Array.from({ length: n }, (_, i) => start + i);
