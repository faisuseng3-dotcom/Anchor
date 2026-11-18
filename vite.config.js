import { defineConfig } from 'vite';
import { frontmanPlugin } from '@frontman-ai/vite';

export default defineConfig({
  plugins: [frontmanPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // krog.html (Qbar för krogar) är en egen sida i samma bygge.
    rollupOptions: { input: { main: 'index.html', krog: 'krog.html' } },
  },
});
