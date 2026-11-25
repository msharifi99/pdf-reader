// pdf_viewer.mjs reads `globalThis.pdfjsLib` at evaluation time; this module must be imported before it.
import * as pdfjs from 'pdfjs-dist';

(globalThis as { pdfjsLib?: typeof pdfjs }).pdfjsLib = pdfjs;
