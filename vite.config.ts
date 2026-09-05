import { defineConfig } from 'vite';

// Served at https://ohitsmiko1.github.io/gestair/ via GitHub Pages,
// so assets must resolve under the /gestair/ subpath in production.
export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/gestair/' : '/',
});
