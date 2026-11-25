import { expect, test, type Frame, type Page } from '@playwright/test';

/* The harness (harness/reflow.html) exposes the engine as window.__reflow; everything runs in
   fake-core mode against /fixtures/reflow/*. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type W = any;

test.use({ viewport: { width: 1000, height: 760 } }); // < 1100px wide: single column, deterministic pages

async function openBook(page: Page, name: string, tocIndex?: number) {
  await page.goto('/harness/reflow.html');
  return page.evaluate(
    async ([n, ix]) => {
      const w = window as W;
      const handle = await w.__reflow.openBook(n);
      if (ix !== undefined) await w.__reflow.engine.goTo(w.__reflow.tocFlat[ix]);
      return { title: handle.metadata.title, authors: handle.metadata.authors, tocCount: handle.toc.length, hasText: handle.hasText };
    },
    [name, tocIndex] as [string, number | undefined],
  );
}

const loc = (page: Page) => page.evaluate(() => (window as W).__reflow.engine.getLocation());
const visible = (page: Page, max = 2000) => page.evaluate((m) => (window as W).__reflow.engine.visibleText(m), max);
/** Resolves with the next `relocated` event after running `action`. */
const relocatedAfter = (page: Page, action: string) =>
  page.evaluate(
    (src) =>
      new Promise<any>((resolve) => {
        const e = (window as W).__reflow.engine;
        const off = e.on('relocated', (ev: any) => {
          off();
          resolve(ev);
        });
        // eslint-disable-next-line no-new-func
        void new Function('e', `return (${src})`)(e);
      }),
    action,
  );
const sectionFrame = (page: Page): Frame => {
  const f = page.frames().find((x) => x.url().startsWith('blob:'));
  if (!f) throw new Error('no section frame');
  return f;
};

test.describe('EPUB 3', () => {
  test('opens, exposes metadata and a nested TOC, shows chapter 1 text', async ({ page }) => {
    const info = await openBook(page, 'epub3.epub', 0);
    expect(info.title).toBe('Quire Test Anthology');
    expect(info.authors).toEqual(['Jane Austen', 'Herman Melville']);
    expect(info.tocCount).toBe(3);
    expect(await visible(page)).toContain('Chapter 1: A Truth Universally Acknowledged');
    const html = await sectionFrame(page).evaluate(() => document.body.textContent);
    expect(html).toContain('It is a truth universally acknowledged');
    const l = await loc(page);
    expect(l.locator.kind).toBe('reflow');
    expect(l.locator.cfi).toMatch(/^epubcfi\(/);
    expect(l.progress.chapter.title).toBe('Chapter 1: A Truth Universally Acknowledged');
  });

  test('metadata extras, landmarks, page list and cover', async ({ page }) => {
    await openBook(page, 'epub3.epub');
    const r = await page.evaluate(async () => {
      const w = window as W;
      const h = w.__reflow.handle;
      const cover = await h.metadata.cover();
      return {
        publisher: h.metadata.publisher,
        language: h.metadata.language,
        series: h.metadata.series,
        wordCount: h.wordCount,
        coverType: cover?.type,
        landmarks: w.__reflow.engine.getLandmarks().map((x: any) => x.label),
        pages: w.__reflow.engine.getPageList().map((x: any) => x.label),
        caps: h.capabilities,
      };
    });
    expect(r.publisher).toBe('Quire Fixtures');
    expect(r.language).toBe('en');
    expect(r.series).toEqual({ name: 'Fixtures', index: 2 });
    expect(r.wordCount).toBeGreaterThan(500);
    expect(r.coverType).toBe('image/png');
    expect(r.landmarks).toEqual(['Cover', 'Start']);
    expect(r.pages).toEqual(['1', '12']);
    expect(r.caps).toMatchObject({ selection: true, search: true, textStream: true, typography: true, flows: true });
  });

  test('next/prev turn pages and change the CFI; page turns are fast without animation', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(() => (window as W).__reflow.engine.setOptions({ animatePageTurns: false }));
    const before = await loc(page);
    const t0 = Date.now();
    const ev = await relocatedAfter(page, 'e.next()');
    const latency = Date.now() - t0;
    expect(ev.reason).toBe('page-turn');
    expect(ev.locator.cfi).not.toBe(before.locator.cfi);
    expect(ev.progress.fraction).toBeGreaterThan(before.progress.fraction);
    expect(latency).toBeLessThan(150); // generous: includes the Playwright round trip
    const back = await relocatedAfter(page, 'e.prev()');
    expect(back.locator.cfi).toBe(before.locator.cfi);
  });

  test('page turn handler time is under 50 ms', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    const ms = await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      e.setOptions({ animatePageTurns: false });
      await new Promise((r) => setTimeout(r, 300));
      return new Promise<number>((resolve) => {
        const off = e.on('relocated', () => {
          off();
          resolve(performance.now() - t0);
        });
        const t0 = performance.now();
        void e.next();
      });
    });
    expect(ms).toBeLessThan(50);
  });

  test('goTo a nested TOC entry lands on that chapter', async ({ page }) => {
    await openBook(page, 'epub3.epub');
    const ev = await relocatedAfter(page, '(() => { const w = window; return e.goTo(w.__reflow.tocFlat[2]); })()');
    expect(ev.progress.chapter.title).toBe('Chapter 2: Loomings');
    expect(await visible(page)).toContain('Chapter 2: Loomings');
    expect(await sectionFrame(page).evaluate(() => document.body.textContent)).toContain('Call me Ishmael');
  });

  test('reopening at a saved CFI lands on exactly the same first visible text', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await relocatedAfter(page, 'e.next()');
    await relocatedAfter(page, 'e.next()');
    const saved = await loc(page);
    const text = await visible(page, 200);
    expect(text.length).toBeGreaterThan(20);

    await page.evaluate(async (l) => {
      await (window as W).__reflow.openBook('epub3.epub', l);
    }, saved.locator);
    const again = await loc(page);
    expect(again.locator.cfi).toBe(saved.locator.cfi);
    expect(await visible(page, 200)).toBe(text);
    const first = await page.evaluate(() => (window as W).__reflow.events.find((e: any) => e.type === 'relocated').detail);
    expect(first.reason).toBe('initial'); // one settled 'initial' event, not the layout churn before it
    expect(first.locator.cfi).toBe(saved.locator.cfi);
    void again;
  });

  test('a corrupted CFI falls back to the fraction', async ({ page }) => {
    await openBook(page, 'epub3.epub');
    await page.evaluate(async () => {
      await (window as W).__reflow.engine.goTo({ kind: 'reflow', cfi: 'epubcfi(/6/999!/4/2)', fraction: 0.5 });
    });
    const l = await loc(page);
    expect(l.progress.fraction).toBeGreaterThan(0.3);
    expect(l.progress.fraction).toBeLessThan(0.8);
  });

  test('changing typography keeps the reading position', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await relocatedAfter(page, 'e.next()');
    const start = (await visible(page, 40)).slice(0, 30);
    await page.evaluate(() => {
      const e = (window as W).__reflow.engine;
      const t = { ...e.pres.typography, fontSize: 28, lineHeight: 1.9 };
      e.setPresentation({ typography: t });
    });
    await expect.poll(() => visible(page, 3000), { timeout: 5000 }).toContain(start);
    // and back down again
    await page.evaluate(() => {
      const e = (window as W).__reflow.engine;
      e.setPresentation({ typography: { ...e.pres.typography, fontSize: 14 } });
    });
    await expect.poll(() => visible(page, 3000), { timeout: 5000 }).toContain(start);
    const px = await sectionFrame(page).evaluate(() => getComputedStyle(document.documentElement).fontSize);
    expect(px).toBe('14px');
  });

  test('Dark theme: dark paper and light ink inside the section iframe, no white canvas', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(() => {
      const w = window as W;
      w.__reflow.engine.setPresentation({ theme: w.__reflow.THEMES.dark });
    });
    const css = await sectionFrame(page).evaluate(() => {
      const p = document.querySelector('p')!;
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        color: getComputedStyle(p).color,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      };
    });
    const lum = (c: string) => {
      const [r, g, b] = c.match(/\d+/g)!.map(Number) as [number, number, number];
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    expect(lum(css.bg)).toBeLessThan(0.2);
    expect(lum(css.htmlBg)).toBeLessThan(0.2);
    expect(lum(css.color)).toBeGreaterThan(0.6); // publisher's #bb0000 is flattened in dark
    expect(css.scheme).toBe('dark');
    // the shell-side host also paints the theme paper (no flash between sections)
    const host = await page.evaluate(() => getComputedStyle(document.querySelector('.quire-reflow')!).backgroundColor);
    expect(lum(host)).toBeLessThan(0.2);
  });

  test('override publisher styles changes the font family (and levels differ)', async ({ page }) => {
    await openBook(page, 'publisher-styles.epub', 0);
    const fam = () => sectionFrame(page).evaluate(() => getComputedStyle(document.querySelector('p.tx')!).fontFamily);
    const color = () => sectionFrame(page).evaluate(() => getComputedStyle(document.querySelector('p.tx')!).color);
    const setLevel = (level: string) =>
      page.evaluate((lv) => {
        const e = (window as W).__reflow.engine;
        e.setPresentation({ typography: { ...e.pres.typography, overridePublisher: lv } });
      }, level);

    expect(await fam()).toContain('Courier'); // publisher class rule wins at 'off'
    expect(await color()).toBe('rgb(29, 27, 23)'); // text colour is the theme's ink at every level (publisher #bb0000 ignored)
    await setLevel('fonts');
    expect(await fam()).toContain('Literata');
    expect(await color()).toBe('rgb(29, 27, 23)');
    await setLevel('all');
    expect(await fam()).toContain('Literata');
    expect(await color()).toBe('rgb(29, 27, 23)'); // theme ink
    // not broken by the reset: images, code font, superscript
    const kept = await sectionFrame(page).evaluate(() => ({
      pre: getComputedStyle(document.querySelector('p.tx')!.ownerDocument.body).fontFamily,
    }));
    expect(kept.pre).toContain('Literata');
  });

  test('override "all" keeps code, tables, images and poetry intact', async ({ page }) => {
    await openBook(page, 'epub3.epub', 3);
    await page.evaluate(() => {
      const e = (window as W).__reflow.engine;
      e.setPresentation({ typography: { ...e.pres.typography, overridePublisher: 'all', textIndent: 2 } });
    });
    await page.waitForTimeout(300);
    const r = await sectionFrame(page).evaluate(() => {
      const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        code: cs('pre code').fontFamily,
        verseIndent: cs('blockquote.poem p').textIndent,
        verseMargin: cs('blockquote.poem').marginLeft,
        para: cs('p.tx').textIndent,
      };
    });
    expect(r.code).toContain('JetBrains Mono');
    expect(parseFloat(r.verseIndent)).toBeLessThan(0); // the book's hanging indent survives
    expect(parseFloat(r.verseMargin)).toBeGreaterThan(10);
    expect(parseFloat(r.para)).toBeGreaterThan(10); // our 2em indent replaced 1.5em
  });

  test('bundled fonts reach the iframe via @font-face with absolute URLs', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    const r = await sectionFrame(page).evaluate(async () => {
      await document.fonts.ready;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
      const rules = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
      return { loaded, abs: /src:url\("https?:\/\//.test(rules) };
    });
    expect(r.abs).toBe(true);
    await page.evaluate(() => {
      const e = (window as W).__reflow.engine;
      e.setPresentation({ typography: { ...e.pres.typography, overridePublisher: 'fonts' } });
    });
    await expect
      .poll(() =>
        sectionFrame(page).evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].some((f) => f.family.includes('Literata') && f.status === 'loaded');
        }),
      )
      .toBe(true);
  });

  test('footnote click raises the footnote event with sanitised html instead of navigating', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const c = e.getContents()[0];
      await e.renderer.goTo({ index: c.index, anchor: (d: Document) => d.getElementById('r1') });
    });
    const before = await loc(page);
    await sectionFrame(page).evaluate(() => document.getElementById('r1')!.click());
    await expect
      .poll(() => page.evaluate(() => (window as W).__reflow.events.filter((e: any) => e.type === 'footnote').length))
      .toBe(1);
    const fn = await page.evaluate(() => (window as W).__reflow.events.find((e: any) => e.type === 'footnote').detail);
    expect(fn.html).toContain('catch-all for fretfulness');
    expect(fn.html).not.toContain('<a');
    expect(fn.html).not.toContain('↩');
    expect(fn.html).not.toMatch(/\s(href|id|class|style)=/);
    expect(fn.rect.width).toBeGreaterThan(0);
    expect(fn.target.kind).toBe('reflow');
    const after = await loc(page);
    expect(after.locator.cfi).toBe(before.locator.cfi);
    expect(after.progress.chapter.title).toBe('Chapter 1: A Truth Universally Acknowledged');
    await expect(page.getByTestId('note')).toContainText('catch-all');
  });

  test('internal links navigate and announce themselves; external links are only announced', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const c = e.getContents()[0];
      await e.renderer.goTo({ index: c.index, anchor: (d: Document) => d.querySelector('a[href="ch2.xhtml"]') });
    });
    await sectionFrame(page).evaluate(() => (document.querySelector('a[href="ch2.xhtml"]') as HTMLElement).click());
    await expect.poll(() => visible(page)).toContain('Chapter 2: Loomings');
    const link = await page.evaluate(() => (window as W).__reflow.events.find((e: any) => e.type === 'link').detail);
    expect(link).toMatchObject({ external: false, target: { kind: 'reflow' } });

    await page.evaluate(() => (window as W).__reflow.engine.goTo((window as W).__reflow.tocFlat[0]));
    await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const c = e.getContents()[0];
      await e.renderer.goTo({ index: c.index, anchor: (d: Document) => d.querySelector('a[href^="https"]') });
    });
    await sectionFrame(page).evaluate(() => (document.querySelector('a[href^="https"]') as HTMLElement).click());
    await expect
      .poll(() => page.evaluate(() => (window as W).__reflow.events.filter((e: any) => e.type === 'link' && e.detail.external).length))
      .toBe(1);
  });

  test('search finds the phrase with an excerpt, anchors and can be aborted', async ({ page }) => {
    await openBook(page, 'epub3.epub');
    const hits = await page.evaluate(async () => {
      const out: any[] = [];
      for await (const h of (window as W).__reflow.engine.search('universally acknowledged', { caseSensitive: true })) out.push(h);
      return out;
    });
    expect(hits).toHaveLength(1);
    // case-insensitive also finds the heading "Universally Acknowledged"
    expect(
      await page.evaluate(async () => {
        let n = 0;
        for await (const _h of (window as W).__reflow.engine.search('universally acknowledged')) n++;
        return n;
      }),
    ).toBe(2);
    expect(hits[0].excerpt.match.toLowerCase()).toBe('universally acknowledged');
    expect(hits[0].excerpt.before).toContain('It is a truth');
    expect(hits[0].anchor.cfiRange).toMatch(/^epubcfi\(/);
    expect(hits[0].section).toContain('Chapter 1');
    expect(hits[0].locator.fraction).toBeGreaterThan(0);

    // stepping: goTo the hit and it is on screen
    await page.evaluate((h) => (window as W).__reflow.engine.goTo(h.locator), hits[0]);
    expect(await visible(page, 3000)).toContain('universally acknowledged');

    const aborted = await page.evaluate(async () => {
      const ctl = new AbortController();
      let n = 0;
      for await (const _h of (window as W).__reflow.engine.search('the', { signal: ctl.signal })) {
        n++;
        if (n === 3) ctl.abort();
      }
      return n;
    });
    expect(aborted).toBeLessThan(40);
    const caseHits = await page.evaluate(async () => {
      let n = 0;
      for await (const _h of (window as W).__reflow.engine.search('ISHMAEL', { caseSensitive: true })) n++;
      return n;
    });
    expect(caseHits).toBe(0);
  });

  test('search highlights are drawn and cleared', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.getByTestId('q').fill('truth');
    await page.getByTestId('find').click();
    await expect.poll(() => page.evaluate(() => (window as W).__reflow.hits.length)).toBeGreaterThan(0);
    await expect
      .poll(() => page.evaluate(() => (window as W).__reflow.engine.contents().overlayer.element.querySelectorAll('g').length))
      .toBeGreaterThan(0);
    await page.evaluate(() => (window as W).__reflow.engine.setDecorations('search', []));
    expect(await page.evaluate(() => (window as W).__reflow.engine.contents().overlayer.element.querySelectorAll('g').length)).toBe(0);
  });

  test('selection -> anchor -> regions -> highlight, click on highlight, fuzzy re-anchoring', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    // select the first sentence of chapter 1 inside the iframe
    await sectionFrame(page).evaluate(() => {
      const p = document.querySelector('p.tx')!;
      const t = p.firstChild as Text;
      const r = document.createRange();
      r.setStart(t, 0);
      r.setEnd(t, 'It is a truth universally acknowledged'.length);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    });
    await expect
      .poll(() => page.evaluate(() => (window as W).__reflow.events.filter((e: any) => e.type === 'selection' && e.detail).length))
      .toBeGreaterThan(0);
    const sel = await page.evaluate(() => (window as W).__reflow.events.filter((e: any) => e.type === 'selection' && e.detail).at(-1).detail);
    expect(sel.text).toBe('It is a truth universally acknowledged');
    expect(sel.anchor.quote.exact).toBe('It is a truth universally acknowledged');
    expect(sel.anchor.quote.suffix.startsWith(', that a single')).toBe(true);
    expect(sel.anchor.cfiRange).toMatch(/^epubcfi\(/);
    expect(sel.anchor.locator.cfi).toMatch(/^epubcfi\(/);
    await expect(page.getByTestId('selmenu')).toBeVisible();

    const res = await page.evaluate(async (a) => {
      const e = (window as W).__reflow.engine;
      const r = await e.anchorToRanges(a);
      const a2 = await e.selectionToAnchor();
      return { exact: r.exact, regions: r.regions.length, rects: r.regions[0]?.rects.length, hasRange: !!r.regions[0]?.range, same: a2?.cfiRange === a.cfiRange };
    }, sel.anchor);
    expect(res).toMatchObject({ exact: true, regions: 1, hasRange: true, same: true });
    expect(res.rects).toBeGreaterThan(0);

    // draw it as an annotation, then click it
    await page.evaluate((a) => {
      (window as W).__reflow.engine.setDecorations('annotations', [{ id: 'h1', anchor: a, style: { type: 'highlight', color: 0 } }]);
    }, sel.anchor);
    await page.evaluate(() => (window as W).__reflow.engine.clearSelection());
    expect(await page.evaluate(() => (window as W).__reflow.engine.contents().overlayer.element.querySelectorAll('g rect').length)).toBeGreaterThan(0);
    await sectionFrame(page).evaluate(() => {
      const p = document.querySelector('p.tx')!;
      const r = document.createRange();
      r.setStart(p.firstChild!, 3);
      r.setEnd(p.firstChild!, 8);
      const b = r.getBoundingClientRect();
      p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
    });
    await expect
      .poll(() => page.evaluate(() => (window as W).__reflow.events.find((e: any) => e.type === 'decorationclick')?.detail))
      .toMatchObject({ layer: 'annotations', id: 'h1' });

    // a stale CFI with a good quote is found again and a refreshed anchor is offered
    const fuzzy = await page.evaluate(async (a) => {
      const e = (window as W).__reflow.engine;
      const r = await e.anchorToRanges({ ...a, cfiRange: 'epubcfi(/6/4[ch1]!/4/2/90/1:0,/1:0,/1:5)', locator: { kind: 'reflow', cfi: 'epubcfi(/6/4[ch1]!/4/2/90/1:0)', fraction: a.locator.fraction } });
      return { exact: r?.exact, updated: r?.updated?.cfiRange, regions: r?.regions.length };
    }, sel.anchor);
    expect(fuzzy.exact).toBe(false);
    expect(fuzzy.updated).toBe(sel.anchor.cfiRange);
    expect(fuzzy.regions).toBe(1);

    // an anchor whose text is gone is orphaned
    const orphan = await page.evaluate(async (a) => (window as W).__reflow.engine.anchorToRanges({ ...a, cfiRange: undefined, quote: { exact: 'this sentence does not exist in the book at all', prefix: '', suffix: '' } }), sel.anchor);
    expect(orphan).toBeNull();
  });

  test('anchors survive a theme change and highlights follow the theme colour', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    const a = await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      let anchor: any;
      for await (const h of e.search('truth')) {
        anchor = h.anchor;
        break;
      }
      e.setDecorations('annotations', [{ id: 'x', anchor, style: { type: 'highlight', color: 1 } }]);
      return anchor;
    });
    const fill = () => page.evaluate(() => (window as W).__reflow.engine.contents().overlayer.element.querySelector('g')?.getAttribute('fill'));
    expect(await fill()).toBe('#bfe3b4');
    await page.evaluate(() => {
      const w = window as W;
      w.__reflow.engine.setPresentation({ theme: w.__reflow.THEMES.dark });
    });
    expect(await fill()).toBe('#2c4f36');
    expect(a.quote.exact.toLowerCase()).toBe('truth');
  });

  test('text stream yields sentence chunks with locators; anchorFor maps a word; speech helper draws it', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    const r = await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const chunks: any[] = [];
      let wordAnchor: any;
      for await (const c of e.textStream(undefined, { maxChunkChars: 200 })) {
        chunks.push({ text: c.text, loc: c.locator, end: c.end });
        if (chunks.length === 2) {
          const i = c.text.indexOf(' ') + 1;
          wordAnchor = { a: await c.anchorFor(i, i + 4), word: c.text.slice(i, i + 4) };
        }
        if (chunks.length === 4) break;
      }
      await e.showSpeech(wordAnchor.a);
      const drawn = e.contents().overlayer.element.querySelectorAll('g').length;
      e.clearSpeech();
      return { chunks, wordAnchor, drawn, after: e.contents().overlayer.element.querySelectorAll('g').length };
    });
    expect(r.chunks).toHaveLength(4);
    expect(r.chunks[0].text).toContain('Chapter 1');
    for (const c of r.chunks) {
      expect(c.text.length).toBeLessThanOrEqual(200);
      expect(c.loc.cfi).toMatch(/^epubcfi\(/);
      expect(c.end.cfi).toMatch(/^epubcfi\(/);
    }
    expect(r.wordAnchor.a.quote.exact).toBe(r.wordAnchor.word);
    expect(r.drawn).toBeGreaterThan(0);
    expect(r.after).toBe(0);
  });

  test('showSpeech turns the page when the spoken word is off screen', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    const turned = await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const start = e.getLocation().locator.cfi;
      let last: any;
      for await (const c of e.textStream(undefined, { maxChunkChars: 100 })) last = c; // last chunk of the book
      await e.showSpeech(await last.anchorFor(0, 5));
      return { start, now: e.getLocation().locator.cfi, fraction: e.getLocation().progress.fraction };
    });
    expect(turned.now).not.toBe(turned.start);
    expect(turned.fraction).toBeGreaterThan(0.5);
  });

  test('getText returns the text between two locators', async ({ page }) => {
    await openBook(page, 'epub3.epub');
    const t = await page.evaluate(async () => {
      const w = window as W;
      return w.__reflow.engine.getText({ from: w.__reflow.tocFlat[2], to: w.__reflow.tocFlat[4] });
    });
    expect(t).toContain('Call me Ishmael');
    expect(t).toContain('Down the Rabbit-Hole');
    expect(t).not.toContain('universally acknowledged');
    expect(t).not.toContain('Letter to Mrs. Saville');
  });

  test('keyboard events inside the section iframe reach window', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(() => {
      (window as W).__keys = [];
      window.addEventListener('keydown', (e) => (window as W).__keys.push({ key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey }));
      window.addEventListener('keyup', (e) => (window as W).__keys.push({ up: e.key }));
    });
    await sectionFrame(page).locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('j');
    await page.keyboard.press('Control+Shift+K');
    const keys = await page.evaluate(() => (window as W).__keys);
    expect(keys).toContainEqual({ key: 'j', ctrl: false, shift: false });
    expect(keys).toContainEqual({ up: 'j' });
    expect(keys).toContainEqual({ key: 'K', ctrl: true, shift: true });
  });

  test('keydown default-prevented on window is prevented in the iframe', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(() => window.addEventListener('keydown', (e) => e.key === 'q' && e.preventDefault()));
    const prevented = await sectionFrame(page).evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'q', bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
  });

  test('mouse wheel turns pages in paginated flow', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(() => (window as W).__reflow.engine.setOptions({ animatePageTurns: false }));
    const before = await loc(page);
    await page.mouse.move(500, 400);
    await page.mouse.wheel(0, 240);
    await expect.poll(async () => (await loc(page)).locator.cfi).not.toBe(before.locator.cfi);
    expect((await loc(page)).progress.fraction).toBeGreaterThan(before.progress.fraction);
  });

  test('clicks emit pointer events with a zone', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await sectionFrame(page).evaluate(() => {
      const el = document.querySelector('p.tx')!;
      const b = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.left + 4, clientY: b.top + 4 }));
    });
    const ptr = await page.evaluate(() => (window as W).__reflow.events.find((e: any) => e.type === 'pointer')?.detail);
    expect(ptr).toBeTruthy();
    expect(['left', 'center', 'right']).toContain(ptr.zone);
  });

  test('scrolled flow: scrollBy moves, hops to the next section at the end', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(() => {
      const w = window as W;
      w.__reflow.engine.setPresentation({ flow: 'scrolled' });
    });
    await page.waitForTimeout(500);
    const a = await loc(page);
    await page.evaluate(() => (window as W).__reflow.engine.scrollBy(300));
    await expect.poll(async () => (await loc(page)).progress.fraction, { timeout: 4000 }).toBeGreaterThan(a.progress.fraction);
    // push past the end of chapter 1: lands in chapter 2
    await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      for (let i = 0; i < 60; i++) {
        e.scrollBy(400);
        await new Promise((r) => setTimeout(r, 40));
      }
    });
    await expect.poll(async () => (await loc(page)).progress.chapter?.title, { timeout: 6000 }).not.toBe('Chapter 1: A Truth Universally Acknowledged');
    // flipping back to paginated keeps us in the same neighbourhood
    const mid = (await loc(page)).progress.fraction;
    await page.evaluate(() => (window as W).__reflow.engine.setPresentation({ flow: 'paginated' }));
    await page.waitForTimeout(600);
    expect(Math.abs((await loc(page)).progress.fraction - mid)).toBeLessThan(0.15);
  });

  test('two-page spread on wide windows, single on narrow, user override wins', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await openBook(page, 'epub3.epub', 0);
    const columns = () => page.evaluate(() => (window as W).__reflow.engine.renderer.getAttribute('max-column-count'));
    await expect.poll(columns).toBe('2');
    await page.evaluate(() => (window as W).__reflow.engine.setPresentation({ spread: 'single' }));
    await expect.poll(columns).toBe('1');
    await page.evaluate(() => (window as W).__reflow.engine.setPresentation({ spread: 'auto' }));
    await page.setViewportSize({ width: 800, height: 800 });
    await expect.poll(columns).toBe('1');
    await page.evaluate(() => (window as W).__reflow.engine.setPresentation({ spread: 'double' }));
    await expect.poll(columns).toBe('2');
  });

  test('animation can be disabled; reduced motion disables it too', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    const animated = () => page.evaluate(() => (window as W).__reflow.engine.renderer.hasAttribute('animated'));
    expect(await animated()).toBe(true);
    await page.evaluate(() => (window as W).__reflow.engine.setOptions({ animatePageTurns: false }));
    expect(await animated()).toBe(false);
    const ctx = await page.context().browser()!.newContext({ reducedMotion: 'reduce', viewport: { width: 1000, height: 760 } });
    const p2 = await ctx.newPage();
    await openBook(p2, 'epub3.epub', 0);
    expect(await p2.evaluate(() => (window as W).__reflow.engine.renderer.hasAttribute('animated'))).toBe(false);
    await ctx.close();
  });

  test('dispose removes the DOM and revokes nothing it should keep', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    await page.evaluate(() => (window as W).__reflow.engine.dispose());
    expect(await page.locator('.quire-reflow').count()).toBe(0);
    const err = await page.evaluate(async () => {
      try {
        await (window as W).__reflow.engine.next();
        return 'no error';
      } catch (e: any) {
        return e.code;
      }
    });
    expect(err).toBe('not-rendered');
  });
});

test.describe('other formats and failures', () => {
  test('EPUB 2 with an NCX opens; nested NCX entries and landmarks work', async ({ page }) => {
    const info = await openBook(page, 'epub2.epub', 0);
    expect(info.title).toBe('Quire Legacy EPUB 2');
    expect(info.authors).toEqual(['Mary Shelley']);
    const toc = await page.evaluate(() => (window as W).__reflow.handle.toc.map((t: any) => [t.title, t.children.map((c: any) => c.title)]));
    expect(toc).toEqual([['Chapter 3: Down the Rabbit-Hole', []], ['Chapter 4: Letter to Mrs. Saville', ['Second paragraph']]]);
    expect(await visible(page)).toContain('Down the Rabbit-Hole');
    await page.evaluate(() => (window as W).__reflow.engine.goTo((window as W).__reflow.tocFlat[2]));
    expect(await visible(page, 3000)).toContain('Inspirited by this wind of promise');
  });

  test('DRM-protected EPUB rejects with a typed drm error', async ({ page }) => {
    await page.goto('/harness/reflow.html');
    const err = await page.evaluate(async () => {
      try {
        await (window as W).__reflow.openBook('drm.epub');
        return null;
      } catch (e: any) {
        return { name: e.name, code: e.code };
      }
    });
    expect(err).toEqual({ name: 'EngineError', code: 'drm' });
  });

  test('corrupt EPUB rejects with a typed corrupt error', async ({ page }) => {
    await page.goto('/harness/reflow.html');
    const err = await page.evaluate(async () => {
      try {
        await (window as W).__reflow.openBook('corrupt.epub');
        return null;
      } catch (e: any) {
        return { name: e.name, code: e.code };
      }
    });
    expect(err).toEqual({ name: 'EngineError', code: 'corrupt' });
  });

  test('unreachable file rejects with a network error, no unhandled rejection', async ({ page }) => {
    const unhandled: string[] = [];
    page.on('pageerror', (e) => unhandled.push(e.message));
    await page.goto('/harness/reflow.html');
    const err = await page.evaluate(async () => {
      try {
        await (window as W).__reflow.openUrl('http://127.0.0.1:9/nope.epub', 'epub');
        return null;
      } catch (x: any) {
        return x.code;
      }
    });
    expect(err).toBe('network');
    expect(unhandled).toEqual([]);
  });

  test('AZW3 (KF8) opens: skeleton/fragment sections, NCX TOC, text, search, reopen', async ({ page }) => {
    const info = await openBook(page, 'azw3.azw3', 0);
    expect(info.title).toBe('Quire AZW3 Sampler');
    expect(info.authors).toEqual(['Herman Melville']);
    expect(info.tocCount).toBe(3);
    expect(await visible(page)).toContain('Loomings');
    await page.evaluate(() => (window as W).__reflow.engine.goTo((window as W).__reflow.tocFlat[1]));
    expect(await visible(page, 3000)).toContain('Down the Rabbit-Hole');
    const hits = await page.evaluate(async () => {
      let n = 0;
      for await (const _h of (window as W).__reflow.engine.search('Inspirited by this wind')) n++;
      return n;
    });
    expect(hits).toBe(1);
    const saved = await loc(page);
    await page.evaluate(async (l) => (window as W).__reflow.openBook('azw3.azw3', l), saved.locator);
    expect((await loc(page)).locator.cfi).toBe(saved.locator.cfi);
  });

  test('DRM MOBI, truncated MOBI and malformed FB2 reject with typed errors', async ({ page }) => {
    await page.goto('/harness/reflow.html');
    const code = (name: string) =>
      page.evaluate(async (n) => {
        try {
          await (window as W).__reflow.openBook(n);
          return null;
        } catch (e: any) {
          return e.code;
        }
      }, name);
    expect(await code('drm.mobi')).toBe('drm');
    expect(await code('corrupt.mobi')).toBe('corrupt');
    expect(await code('corrupt.fb2')).toBe('corrupt');
  });

  test('FB2 opens with metadata, TOC, a note popup and a cover', async ({ page }) => {
    const info = await openBook(page, 'fb2.fb2', 0);
    expect(info.title).toBe('Quire FB2 Sampler');
    expect(info.authors).toEqual(['Lewis Carroll']);
    expect(await visible(page)).toContain('Down the Rabbit-Hole');
    const cover = await page.evaluate(async () => (await (window as W).__reflow.handle.metadata.cover())?.type);
    expect(cover).toBe('image/png');
    await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const c = e.getContents()[0];
      await e.renderer.goTo({ index: c.index, anchor: (d: Document) => d.querySelector('a[href="#n1"]') });
    });
    await sectionFrame(page).evaluate(() => (document.querySelector('a[href="#n1"]') as HTMLElement).click());
    await expect
      .poll(() => page.evaluate(() => (window as W).__reflow.events.find((e: any) => e.type === 'footnote')?.detail.html))
      .toContain('The note body');
  });

  test('FBZ (zipped FB2) opens', async ({ page }) => {
    const info = await openBook(page, 'fb2.fbz', 0);
    expect(info.title).toBe('Quire FB2 Sampler');
    expect(await visible(page)).toContain('Down the Rabbit-Hole');
  });

  test('MOBI opens: metadata, TOC, text, search, cursor positions', async ({ page }) => {
    const info = await openBook(page, 'mobi.mobi', 0);
    expect(info.title).toBe('Quire MOBI Sampler');
    expect(info.authors).toEqual(['Mary Shelley']);
    expect(info.tocCount).toBe(3);
    expect(await visible(page)).toContain('Letter to Mrs. Saville');
    await page.evaluate(() => (window as W).__reflow.engine.goTo((window as W).__reflow.tocFlat[2]));
    expect(await visible(page, 3000)).toContain('Loomings');
    const hits = await page.evaluate(async () => {
      let n = 0;
      for await (const _h of (window as W).__reflow.engine.search('Call me Ishmael')) n++;
      return n;
    });
    expect(hits).toBe(1);
    const saved = await loc(page);
    await page.evaluate(async (l) => (window as W).__reflow.openBook('mobi.mobi', l), saved.locator);
    expect((await loc(page)).locator.cfi).toBe(saved.locator.cfi);
  });
});
