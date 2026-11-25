// foliate-js ships plain ESM without types. Everything is treated as `any` at the seam
// (engine.ts wraps it); the engine's own surface is fully typed.
declare module 'foliate-js/view.js';
declare module 'foliate-js/epub.js';
declare module 'foliate-js/mobi.js';
declare module 'foliate-js/fb2.js';
declare module 'foliate-js/epubcfi.js';
declare module 'foliate-js/progress.js';
declare module 'foliate-js/overlayer.js';
declare module 'foliate-js/search.js';
declare module 'foliate-js/text-walker.js';
declare module 'foliate-js/vendor/fflate.js';
