import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, firefox, webkit } from '@playwright/test';

const require = createRequire(import.meta.url);
const { version } = require('@playwright/test/package.json');
// Package and Docker image upgrades must move together. An image with different
// browser revisions fails here instead of falling back to network installation.
for (const browser of [chromium, firefox, webkit]) {
  const executable = browser.executablePath();
  try {
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(`Missing ${browser.name()} executable for Playwright ${version}. Align the CI image with package-lock.json: ${executable}`);
  }
  // Catch container ownership or shared-library failures before the full suite.
  const instance = await browser.launch();
  await instance.close();
  console.log(`PASS: Playwright ${version} ${browser.name()} is preinstalled and launches`);
}
