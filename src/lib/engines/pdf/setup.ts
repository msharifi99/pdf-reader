import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let ready = false;

/** Point pdf.js at its bundled worker; idempotent. */
export function setupPdfjs(): typeof pdfjs {
  if (!ready) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    ready = true;
  }
  return pdfjs;
}

/** Absolute URL of a bundled data folder (public/pdfjs/...), so the worker can fetch it offline. */
export function dataUrl(dir: 'cmaps' | 'standard_fonts' | 'wasm' | 'iccs'): string {
  return new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, document.baseURI).href;
}
