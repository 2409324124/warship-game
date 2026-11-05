import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the build has to run from whatever subpath it is hosted under
  // (GitHub Pages serves project sites from /<repo>/), so nothing may start with a slash.
  base: './',
  server: { host: '127.0.0.1', port: 5173, open: false },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
});
