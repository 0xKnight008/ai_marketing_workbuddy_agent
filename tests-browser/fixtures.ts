import { test as base } from '@playwright/test';

export { expect, type Page } from '@playwright/test';

// Functional/accessibility checks must not wait on the public font CDN.
// Keep the application's normal CSS fallback fonts; production is unchanged.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route =>
      route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
    );
    await use(context);
  },
});
