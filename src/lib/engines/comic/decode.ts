/** Blob -> ImageBitmap, off the main thread where the browser allows it. */
import { EngineError } from '../types';

/** Decoded pages are capped at this many pixels on their long side (a 6000 px scan is never shown larger than a screen). */
export const MAX_SIDE = 4096;
const SVG_TARGET = 2400;

async function rasterizeSvg(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const nw = img.naturalWidth || 800;
    const nh = img.naturalHeight || 1200;
    const s = SVG_TARGET / Math.max(nw, nh);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(nw * s)), Math.max(1, Math.round(nh * s)));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeBlob(blob: Blob, name: string): Promise<ImageBitmap> {
  try {
    if (blob.type === 'image/svg+xml' || /\.svg$/i.test(name)) return await rasterizeSvg(blob);
    const bm = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const long = Math.max(bm.width, bm.height);
    if (long <= MAX_SIDE) return bm;
    const k = MAX_SIDE / long;
    const small = await createImageBitmap(bm, { resizeWidth: Math.round(bm.width * k), resizeHeight: Math.round(bm.height * k), resizeQuality: 'high' });
    bm.close();
    return small;
  } catch (e) {
    throw new EngineError('corrupt', `${name} could not be decoded`, { cause: e });
  }
}

/** Thumbnail decode: scales while decoding, so a huge page never sits in memory at full size. */
export async function decodeThumbnail(blob: Blob, name: string, maxWidth: number): Promise<ImageBitmap> {
  if (blob.type === 'image/svg+xml' || /\.svg$/i.test(name)) {
    const full = await decodeBlob(blob, name);
    const k = Math.min(1, maxWidth / full.width);
    const out = await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(full.width * k)), resizeQuality: 'high' });
    full.close();
    return out;
  }
  try {
    const probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const k = Math.min(1, maxWidth / probe.width);
    if (k === 1) return probe;
    const out = await createImageBitmap(probe, { resizeWidth: Math.max(1, Math.round(probe.width * k)), resizeQuality: 'high' });
    probe.close();
    return out;
  } catch (e) {
    throw new EngineError('corrupt', `${name} could not be decoded`, { cause: e });
  }
}

/** Stand-in for a page that failed to decode, so layout and paging keep working. */
export async function placeholderBitmap(label: string): Promise<ImageBitmap> {
  const c = new OffscreenCanvas(800, 1200);
  const g = c.getContext('2d')!;
  g.fillStyle = '#7777';
  g.fillRect(0, 0, 800, 1200);
  g.fillStyle = '#bbb';
  g.font = '32px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(label, 400, 600);
  return createImageBitmap(c);
}
