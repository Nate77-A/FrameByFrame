import { defineConfig, devices } from '@playwright/test';

const base = { baseURL: 'http://localhost:5198', acceptDownloads: true };
export default defineConfig({
  testDir: 'tests', timeout: 60000, workers: 2,
  use: base,
  webServer: { command: 'npm run dev -- --port 5198 --strictPort', port: 5198, reuseExistingServer: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...base, viewport: { width: 1280, height: 800 },
      launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...base, viewport: { width: 1280, height: 800 } } },
    // Opt-in with E2E_FIREFOX=1: the bundled Firefox build would not launch on the development Mac.
    ...(process.env.E2E_FIREFOX ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'], ...base, viewport: { width: 1280, height: 800 } } }] : []),
  ],
});
