import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({base:'./',plugins:[react()],build:{outDir:'classic-dist',rollupOptions:{input:'classic.html'},assetsInlineLimit:1000000}});
