import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// npm run build        → app normale in dist/
// npm run build:single → un solo file HTML (dist-single/index.html) da aprire con doppio clic
// npm run build:demo   → come single, ma per l'anteprima online (download disattivati)
export default defineConfig(({ mode }) => {
  const single = mode === 'single' || mode === 'demo';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      outDir: mode === 'demo' ? 'dist-demo' : single ? 'dist-single' : 'dist',
      target: 'es2020',
    },
  };
});
