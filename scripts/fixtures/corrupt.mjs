// Adds the corrupt fixtures that the format generators don't write: AZW3, FBZ, CBR and a broken image.
// Deterministic and built from the committed fixtures: `node scripts/fixtures/corrupt.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';

const fx = 'public/fixtures';
const rd = (p) => readFileSync(`${fx}/${p}`);
let seed = 11;
const noise = (n) => Buffer.from(Array.from({ length: n }, () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255));

// AZW3 / KF8: valid Palm header, then the file just stops (the record table points past the end)
writeFileSync(`${fx}/reflow/corrupt.azw3`, rd('reflow/azw3.azw3').subarray(0, 700));
// FBZ: a zip cut off mid-archive (no central directory)
writeFileSync(`${fx}/reflow/corrupt.fbz`, rd('reflow/fb2.fbz').subarray(0, 2400));
// CBR: the RAR 5 signature followed by noise
writeFileSync(`${fx}/comic/corrupt.cbr`, Buffer.concat([Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]), noise(300)]));
// a PNG whose data is garbage after the signature (a single image opens as a one-page book)
writeFileSync(`${fx}/comic/corrupt-image.png`, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), noise(200)]));
console.log('corrupt fixtures written');
