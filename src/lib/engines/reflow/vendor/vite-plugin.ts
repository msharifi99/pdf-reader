import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Serve our vendored paginator.js wherever foliate-js's view.js imports its own ('./paginator.js'). */
export const foliatePaginator = (): Plugin => ({
  name: 'quire-foliate-paginator',
  enforce: 'pre',
  resolveId(id, importer) {
    // the importer can carry a dev-server `?v=hash` query
    if (id === './paginator.js' && /[\\/]node_modules[\\/]foliate-js[\\/]view\.js(\?|$)/.test(importer ?? ''))
      return fileURLToPath(new URL('./paginator.js', import.meta.url));
  },
});
