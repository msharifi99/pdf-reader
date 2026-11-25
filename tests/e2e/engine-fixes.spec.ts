import { type Frame, type Page } from '@playwright/test';
import { expect, test } from './helpers/test';

/* Regression tests for the reflow/pdf engine fixes: font cascade, element-level CFIs, location numbers,
   page-turn duration, PDF goToFraction(1) and monotonic progress. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type W = any;

test.describe('reflow', () => {
  test.use({ viewport: { width: 1000, height: 760 } });

  async function openBook(page: Page, name: string, tocIndex?: number) {
    await page.goto('/harness/reflow.html');
    await page.evaluate(
      async ([n, ix]) => {
        const w = window as W;
        await w.__reflow.openBook(n);
        if (ix !== undefined) await w.__reflow.engine.goTo(w.__reflow.tocFlat[ix]);
      },
      [name, tocIndex] as [string, number | undefined],
    );
  }
  const frame = (page: Page): Frame => {
    const f = page.frames().find((x) => x.url().startsWith('blob:'));
    if (!f) throw new Error('no section frame');
    return f;
  };
  test("body text gets the user font; only a publisher class rule (the fixture's p.tx) overrides it", async ({ page }) => {
    await openBook(page, 'fb2.fb2');
    const fam = await frame(page).evaluate(() => getComputedStyle(document.querySelector('p')!).fontFamily);
    expect(fam).toContain('Literata');

    await openBook(page, 'epub3.epub', 0);
    const own = await frame(page).evaluate(() => getComputedStyle(document.querySelector('p.tx')!).fontFamily);
    expect(own).toContain('Literata'); // the realistic fixture sets no body font (only Georgia, serif): the user's font wins
    await openBook(page, 'publisher-styles.epub', 0);
    const res = await frame(page).evaluate(() => {
      const mk = (cls: string) => {
        const p = document.createElement('p');
        p.className = cls;
        p.textContent = 'x';
        document.body.append(p);
        return getComputedStyle(p).fontFamily;
      };
      return {
        tx: getComputedStyle(document.querySelector('p.tx') ?? document.body).fontFamily,
        monologue: mk('monologue'),
        decode: mk('decode barcode'),
        code: mk('code'),
      };
    });
    // epub3.epub chapter 1's paragraphs are `p.tx { font-family: "Courier New" }` in publisher-styles.epub: the publisher's explicit choice
    expect(res.tx).toContain('Courier');
    // class names that merely contain "mono"/"code" are prose, not code
    expect(res.monologue).toContain('Literata');
    expect(res.decode).toContain('Literata');
    expect(res.code).toContain('JetBrains');
  });

  test('text colour follows the theme in every theme, publisher colours and link colours included', async ({ page }) => {
    await openBook(page, 'publisher-styles.epub', 0);
    for (const t of ['light', 'dark', 'solarized']) {
      const r = await page.evaluate(async (id) => {
        const w = window as W;
        w.__reflow.engine.setPresentation({ theme: w.__reflow.THEMES[id] });
        await new Promise((res) => setTimeout(res, 200));
        const d = w.__reflow.engine.contents().doc;
        const a = d.createElement('a');
        a.href = 'http://x.test/';
        a.textContent = 'l';
        d.body.append(a);
        return { ink: w.__reflow.THEMES[id].text, p: getComputedStyle(d.querySelector('p.tx')).color, link: getComputedStyle(a).color, linkWant: w.__reflow.THEMES[id].link };
      }, t);
      const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      expect(r.p, t).toBe(rgb(r.ink));
      expect(r.link, t).toBe(rgb(r.linkWant));
    }
  });

  test('relocated never reports an element-level CFI, goTo(element CFI) lands on that element, and re-layout keeps the spot', async ({ page }) => {
    await openBook(page, 'epub3.epub', 1);
    // ends in a text offset, never in a bare element step like /4 or /4/18; the one exception is the text-less figure
    // (/4/14), where the element itself is the exact position (a page can begin with it)
    const textCfi = /\/\d+:\d+\)$|^epubcfi\(\/6\/6!\/4\/14\)$/;
    // every element child of <body>, by CFI
    const n = await frame(page).evaluate(() => document.body.children.length);
    for (let i = 0; i < n; i++) {
      const cfi = `epubcfi(/6/6!/4/${2 * (i + 1)})`;
      await page.evaluate((c) => (window as W).__reflow.engine.goTo({ kind: 'reflow', cfi: c, fraction: 0 }), cfi);
      await page.waitForTimeout(150);
      const inView = await page.evaluate((idx) => {
        const e = (window as W).__reflow.engine;
        const el = e.contents().doc.body.children[idx];
        const r: Range = e.view.lastLocation.range;
        // the element starts inside the visible range, or the range starts inside the element (a tall element)
        return r.comparePoint(el, 0) === 0 || el.contains(r.startContainer);
      }, i);
      expect(inView, `child ${i} (${cfi}) is on screen`).toBe(true);
      expect((await page.evaluate(() => (window as W).__reflow.engine.getLocation())).locator.cfi).toMatch(textCfi);
    }

    // mid-chapter, then a typography change: the engine re-anchors on the first visible text
    await page.evaluate(() => (window as W).__reflow.engine.goTo({ kind: 'reflow', cfi: 'epubcfi(/6/6!/4/10[p3])', fraction: 0 }));
    await page.waitForTimeout(200);
    // (an unchanged position is only a 'layout' event, so wait on the engine's layout rather than on `relocated`)
    await page.evaluate(
      () =>
        new Promise<void>((res) => {
          const e = (window as W).__reflow.engine;
          const off = e.on('layout', () => (off(), res()));
          e.setPresentation({ typography: { ...e.pres.typography, fontSize: 21 } });
        }),
    );
    expect((await page.evaluate(() => (window as W).__reflow.engine.getLocation())).locator.cfi).toMatch(textCfi);
    await page.waitForTimeout(300);
    // the page is re-flowed, but it still shows the paragraph we were reading (not an element-level jump to the chapter start)
    const kept = await page.evaluate(() => {
      const e = (window as W).__reflow.engine;
      const el = e.contents().doc.getElementById('p3');
      const r: Range = e.view.lastLocation.range;
      return r.comparePoint(el, 0) === 0 || el.contains(r.startContainer);
    });
    expect(kept).toBe(true);
  });

  test('page turns never report the empty padding page (a coarse <body> CFI)', async ({ page }) => {
    await openBook(page, 'epub3.epub', 1);
    const cfis: string[] = await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const seen: string[] = [];
      e.on('relocated', (ev: any) => seen.push(ev.locator.cfi));
      for (let i = 0; i < 4; i++) await e.next();
      await new Promise((r) => setTimeout(r, 300));
      return seen;
    });
    expect(cfis.length).toBeGreaterThan(2);
    // a text offset, or the text-less figure that can begin a page; never a coarse element like <body> (/4)
    for (const c of cfis) expect(c).toMatch(/\/\d+:\d+\)$|^epubcfi\(\/6\/6!\/4\/14\)$/);
  });

  test('location index and count agree with the fraction shown next to them', async ({ page }) => {
    await openBook(page, 'epub3.epub', 0);
    const evs: any[] = await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const seen: any[] = [];
      e.on('relocated', (ev: any) => seen.push(ev));
      for (let i = 0; i < 10; i++) {
        await e.next();
        await new Promise((r) => setTimeout(r, 160));
      }
      await e.goToFraction(0.468);
      await new Promise((r) => setTimeout(r, 300));
      seen.push(e.getLocation());
      return JSON.parse(JSON.stringify(seen));
    });
    expect(evs.length).toBeGreaterThan(5);
    for (const ev of evs) {
      const { index, count } = ev.progress.location;
      expect(index).toBe(Math.min(count - 1, Math.floor(ev.progress.fraction * count)));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(count);
    }
    // never "Location 1 of 9" at 46.8%
    const mid = evs.at(-1);
    expect(mid.progress.fraction).toBeGreaterThan(0.3);
    expect(mid.progress.location.index + 1).toBeGreaterThan(2);
  });

  test('page-turn animation is 180 ms by default, configurable, and off on request', async ({ page }) => {
    await openBook(page, 'epub3.epub', 1);
    const r = await page.evaluate(async () => {
      const e = (window as W).__reflow.engine;
      const attr = () => e.renderer.getAttribute('animation-duration');
      const out: any = { def: attr(), animated: e.renderer.hasAttribute('animated') };
      const t0 = performance.now();
      await e.next();
      out.turnMs = performance.now() - t0;
      e.setOptions({ pageTurnMs: 60 });
      out.custom = attr();
      e.setOptions({ animatePageTurns: false });
      out.off = e.renderer.hasAttribute('animated');
      return out;
    });
    expect(r.def).toBe('180');
    expect(r.animated).toBe(true);
    expect(r.turnMs).toBeGreaterThanOrEqual(170); // a real animation, shorter than the old 300 ms constant
    expect(r.custom).toBe('60');
    expect(r.off).toBe(false);
  });
});

test.describe('pdf', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  for (const file of ['text.pdf', 'big.pdf']) {
    for (const flow of ['scrolled', 'paginated']) {
      test(`${file} ${flow}: goToFraction is exact for 0, 0.5 and 1`, async ({ page }) => {
        await page.goto('/harness/pdf.html');
        const res = await page.evaluate(
          async ([f, fl]) => {
            const h = (window as W).__h;
            await h.open(f, { flow: fl, fit: fl === 'paginated' ? 'page' : 'width' });
            const e = h.engine;
            const out: any = { count: h.handle.pageCount };
            for (const fr of [0, 0.5, 1]) {
              await e.goToFraction(fr);
              await new Promise((r) => setTimeout(r, 400)); // late size corrections must not move it
              const l = e.getLocation();
              const root = document.querySelector('.q-pdf') as HTMLElement;
              out[fr] = { page: l.locator.page, y: l.locator.y, fraction: l.progress.fraction, toEnd: root.scrollHeight - root.clientHeight - root.scrollTop };
            }
            return out;
          },
          [file, flow] as const,
        );
        const n = res.count;
        expect(res[0]).toMatchObject({ page: 0, fraction: 0 });
        expect(res[0.5].page).toBe(Math.floor(n / 2));
        expect(res[0.5].fraction).toBeCloseTo(0.5, 3);
        expect(res[1].fraction).toBe(1);
        expect(res[1].toEnd).toBeLessThanOrEqual(1); // scrolled to the very end
        expect(res[1].page).toBeGreaterThanOrEqual(n - 2); // never "several pages short"
      });
    }
  }

  test('relocated fraction is monotonic while scrolling through the whole document', async ({ page }) => {
    await page.goto('/harness/pdf.html');
    const fr: number[] = await page.evaluate(async () => {
      const h = (window as W).__h;
      await h.open('text.pdf', { flow: 'scrolled', fit: 'width' });
      const root = document.querySelector('.q-pdf') as HTMLElement;
      const seen: number[] = [];
      h.engine.on('relocated', (ev: any) => seen.push(ev.progress.fraction));
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      while (root.scrollTop < root.scrollHeight - root.clientHeight - 1) {
        h.engine.scrollBy(180);
        await frame();
      }
      await frame();
      await frame();
      return seen;
    });
    expect(fr.length).toBeGreaterThan(10);
    for (let i = 1; i < fr.length; i++) expect(fr[i]!, `event ${i}`).toBeGreaterThanOrEqual(fr[i - 1]! - 1e-9);
    expect(fr.at(-1)).toBe(1);
  });

  test('textStream puts a heading in its own chunk', async ({ page }) => {
    await page.goto('/harness/pdf.html');
    const chunks: string[] = await page.evaluate(async () => {
      const h = (window as W).__h;
      await h.open('text.pdf', {});
      const out: string[] = [];
      for await (const c of h.engine.textStream()) {
        out.push(c.text.trim());
        if (out.length >= 3) break;
      }
      return out;
    });
    expect(chunks[0]).toBe('Chapter 1');
    expect(chunks[2]).toMatch(/^The harbour pilot/);
    expect(chunks[2]).not.toMatch(/Chapter|Marker/);
  });

  test('spoken-word boxes sit exactly on the words in the text layer (no one-character shift)', async ({ page }) => {
    await page.goto('/harness/pdf.html');
    const res: Array<{ word: string; box: number[]; dom: number[] | null }> = await page.evaluate(async () => {
      const h = (window as W).__h;
      await h.open('text.pdf', {});
      await expect_rendered();
      const e = h.engine;
      let chunk: any;
      for await (const c of e.textStream()) {
        if (c.text.startsWith('The harbour')) {
          chunk = c;
          break;
        }
      }
      const stage = document.getElementById('stage')!.getBoundingClientRect();
      const layer = document.querySelector('.q-page[data-page="0"] .textLayer') as HTMLElement;
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      const out: any[] = [];
      for (const word of ['pilot', 'spiral', 'evening', 'cold', 'iron', 'rail']) {
        const i = chunk.text.indexOf(word);
        const r = await e.anchorToRanges(await chunk.anchorFor(i, i + word.length));
        const box = r.regions[0].rects[0];
        let dom: number[] | null = null;
        walker.currentNode = layer;
        for (let n = walker.nextNode(); n && !dom; n = walker.nextNode()) {
          const k = (n as Text).data.indexOf(word);
          if (k < 0) continue;
          const rg = document.createRange();
          rg.setStart(n, k);
          rg.setEnd(n, k + word.length);
          const b = rg.getBoundingClientRect();
          dom = [b.left, b.width];
        }
        out.push({ word, box: [box.x + stage.left, box.width], dom });
      }
      return out;
      async function expect_rendered() {
        for (let i = 0; i < 100 && !document.querySelector('.q-page[data-page="0"] .textLayer span'); i++) await new Promise((r) => setTimeout(r, 50));
      }
    });
    for (const r of res) {
      expect(r.dom, r.word).not.toBeNull();
      expect(Math.abs(r.box[0] - r.dom![0]), `${r.word} left`).toBeLessThan(2);
      expect(Math.abs(r.box[1] - r.dom![1]), `${r.word} width`).toBeLessThan(2);
    }
  });

  test('an unresolvable decoration anchor is looked up once and never loops', async ({ page }) => {
    await page.goto('/harness/pdf.html');
    const r = await page.evaluate(async () => {
      const h = (window as W).__h;
      await h.open('text.pdf', {});
      const e = h.engine;
      let calls = 0;
      const orig = e.resolveAnchor.bind(e);
      e.resolveAnchor = (a: any) => (calls++, orig(a));
      const ghost = { locator: { kind: 'fixed', page: 0, y: 0.1 }, quote: { exact: 'this sentence appears nowhere in the book', prefix: '', suffix: '' } };
      e.setDecorations('annotations', [{ id: 'ghost', anchor: ghost, style: { type: 'highlight', color: 0 } }]);
      await new Promise((res) => setTimeout(res, 800));
      const settled = calls;
      await new Promise((res) => setTimeout(res, 300));
      return { settled, later: calls };
    });
    expect(r.settled).toBeLessThanOrEqual(2);
    expect(r.later).toBe(r.settled);
  });

  test('clicking a highlight emits decorationclick (and no page-turn pointer); light themes multiply, dark ones screen', async ({ page }) => {
    await page.goto('/harness/pdf.html');
    await page.evaluate(async () => {
      const h = (window as W).__h;
      await h.open('text.pdf', { theme: 'light' });
      for (let i = 0; i < 100 && !document.querySelector('.q-page[data-page="0"] .textLayer span'); i++) await new Promise((r) => setTimeout(r, 50));
      const e = h.engine;
      let chunk: any;
      for await (const c of e.textStream()) {
        if (c.text.startsWith('The harbour')) {
          chunk = c;
          break;
        }
      }
      const anchor = await chunk.anchorFor(0, 20);
      e.setDecorations('annotations', [{ id: 'hl1', anchor, style: { type: 'highlight', color: 0 } }]);
      (window as W).__clicks = [];
      e.on('decorationclick', (d: any) => (window as W).__clicks.push(['deco', d.id, d.layer]));
      e.on('pointer', () => (window as W).__clicks.push(['pointer']));
    });
    const box = page.locator('.q-d[data-deco="hl1"]').first();
    await expect(box).toBeVisible();
    expect(await box.evaluate((el) => getComputedStyle(el).mixBlendMode)).toBe('multiply');
    const b = (await box.boundingBox())!;
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    expect(await page.evaluate(() => (window as W).__clicks)).toEqual([['deco', 'hl1', 'annotations']]);
    // elsewhere on the page it is still a plain pointer event
    await page.mouse.click(b.x + b.width / 2, b.y + b.height + 200);
    expect((await page.evaluate(() => (window as W).__clicks)).at(-1)).toEqual(['pointer']);

    const dark = await page.evaluate(async () => {
      const h = (window as W).__h;
      const deco = h.engine.decos.annotations;
      await h.open('text.pdf', { theme: 'dark' });
      for (let i = 0; i < 100 && !document.querySelector('.q-page[data-page="0"] .textLayer span'); i++) await new Promise((r) => setTimeout(r, 50));
      h.engine.setDecorations('annotations', deco);
      await new Promise((r) => setTimeout(r, 200));
      return getComputedStyle(document.querySelector('.q-d[data-deco="hl1"]')!).mixBlendMode;
    });
    expect(dark).toBe('screen');
  });
});
