/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative paths work at any address: a Pages subfolder, a renamed repo or a custom domain.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'FrAnimator', short_name: 'FrAnimator', description: 'Draw and animate frame by frame.',
        id: './', start_url: './', scope: './',
        theme_color: '#1a1a2e', background_color: '#1a1a2e', display: 'standalone', orientation: 'any',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,woff2}'], maximumFileSizeToCacheInBytes: 5 * 1024 * 1024 },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 900,
    rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'konva', test: /node_modules[\\/]konva/ }, { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } } },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
});
