import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-browser',
  use: { baseURL: 'http://127.0.0.1:5178', launchOptions: process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {} },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 5178 --strictPort', url: 'http://127.0.0.1:5178', reuseExistingServer: false, env: { VITE_GATEWAY_URL: 'http://127.0.0.1:5178' } },
});
