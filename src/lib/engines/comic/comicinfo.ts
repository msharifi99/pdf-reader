/** ComicInfo.xml (ComicRack / Anansi schema) -> the few fields Quire uses. Regex-based: no DOM needed, so it runs in tests. */

export interface ComicInfoPage {
  /** 0-based index into the page list. */
  image: number;
  type?: string;
  bookmark?: string;
  width?: number;
  height?: number;
}

export interface ComicInfo {
  title?: string;
  series?: string;
  number?: string;
  writer?: string;
  publisher?: string;
  summary?: string;
  language?: string;
  year?: number;
  /** `Manga=YesAndRightToLeft`. */
  rtl: boolean;
  pages: ComicInfoPage[];
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

export function parseComicInfo(xml: string): ComicInfo {
  const tag = (name: string): string | undefined => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
    const v = m ? decode(m[1]!) : '';
    return v || undefined;
  };
  const pages: ComicInfoPage[] = [];
  for (const m of xml.matchAll(/<Page\b([^>]*?)\/?>/gi)) {
    const attr = (n: string) => new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"`, 'i').exec(m[1]!)?.[1];
    const image = Number(attr('Image'));
    if (!Number.isInteger(image) || image < 0) continue;
    const w = Number(attr('ImageWidth'));
    const h = Number(attr('ImageHeight'));
    const bm = attr('Bookmark');
    pages.push({ image, type: attr('Type'), bookmark: bm ? decode(bm) : undefined, width: w > 0 ? w : undefined, height: h > 0 ? h : undefined });
  }
  const year = Number(tag('Year'));
  return {
    title: tag('Title'),
    series: tag('Series'),
    number: tag('Number'),
    writer: tag('Writer'),
    publisher: tag('Publisher'),
    summary: tag('Summary'),
    language: tag('LanguageISO'),
    year: year > 0 ? year : undefined,
    rtl: /^yesandrighttoleft$/i.test(tag('Manga') ?? ''),
    pages,
  };
}
