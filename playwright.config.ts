import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests', timeout: 60000, workers: 2,
  use: { baseURL: 'http://localhost:5198', viewport: { width: 1280, height: 800 }, acceptDownloads: true, ...devices['Desktop Chrome'], permissions: [] },
  webServer: { command: 'npm run dev -- --port 5198 --strictPort', port: 5198, reuseExistingServer: true },
});
