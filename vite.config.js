import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Karavay-LK (React): собирается в единый бандл в dist/.
// Если понадобится инлайнить всё в один HTML-файл (как у vanilla-версии
// для деплоя в PocketBase pb_public/), позже можно добавить
// vite-plugin-singlefile — сюда, в plugins.
export default defineConfig({
  base: '/react-test/',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    include: ['tests/**/*.test.jsx'],
  },
});
