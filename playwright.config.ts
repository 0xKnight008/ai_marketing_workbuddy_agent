import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests-browser', timeout: 60_000, expect: { timeout: 10_000 },
  fullyParallel: true, workers: 2, retries: 0,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5178', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome'], ...(process.env.BROWSER_EXECUTABLE ? {launchOptions: {executablePath: process.env.BROWSER_EXECUTABLE}} : {})}},
    {name: 'firefox', use: {...devices['Desktop Firefox']}},
    {name: 'webkit', use: {...devices['Desktop Safari']}},
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort', url: 'http://127.0.0.1:5178', reuseExistingServer: false, env: { VITE_GATEWAY_URL: 'http://127.0.0.1:5178' } },
});
