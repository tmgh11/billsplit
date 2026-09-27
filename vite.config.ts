import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' lets the built site work from any sub-path (e.g. GitHub Pages /billsplit/)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
