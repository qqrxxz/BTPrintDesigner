import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The renderer is bundled from source rather than from the core package's build
 * output, so a change in the rendering engine shows up in the app without a
 * rebuild step in between. Everything ships as relative paths because Electron
 * loads the built page from the file system, not from a server.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@btpd/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome128' },
});
