/** Page discovery inside an archive / folder: which entries are pages, and in what order. */

const PAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Natural order ("page2" < "page10"), compared folder by folder; a file sorts before the contents of a sibling folder. */
export function naturalCompare(a: string, b: string): number {
  const pa = a.replace(/\\/g, '/').split('/');
  const pb = b.replace(/\\/g, '/').split('/');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const aLast = i === pa.length - 1;
    const bLast = i === pb.length - 1;
    if (aLast !== bLast) return aLast ? -1 : 1;
    const c = collator.compare(pa[i]!, pb[i]!);
    if (c) return c;
  }
  return pa.length - pb.length;
}

/** True for real page images; false for __MACOSX, dotfiles, Thumbs.db, ComicInfo.xml and everything that is not an image. */
export function isPageName(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/');
  const base = parts[parts.length - 1]!;
  if (!base || parts.some((p) => p === '__MACOSX' || p.startsWith('.'))) return false;
  return PAGE_EXT.test(base);
}

/** Page names only, in reading order. */
export function sortPages(paths: string[]): string[] {
  return paths.filter(isPageName).sort(naturalCompare);
}

export function mimeFor(name: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'avif': return 'image/avif';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

export const baseName = (p: string): string => p.replace(/\\/g, '/').split('/').pop() ?? p;
export const stripExt = (n: string): string => n.replace(/\.[^.]+$/, '');
