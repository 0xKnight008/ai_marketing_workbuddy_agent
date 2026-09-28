import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { CONNECTION_PLATFORMS, supportsAnnouncement, supportsPostAction, publicationAvailability } = createRequire(import.meta.url)('../../../platform/src/zernio/social-platforms.ts') as typeof import('../../../platform/src/zernio/social-platforms');
import { targetSchema } from './announcement';

test('V1 retains fourteen connections while AI targets remain text-only LinkedIn and X', () => {
  assert.equal(CONNECTION_PLATFORMS.length, 14);
  assert.equal(new Set(CONNECTION_PLATFORMS.map(([id]) => id)).size, 14);
  for (const [platform] of CONNECTION_PLATFORMS) {
    const targetPlatform = platform === 'twitter' ? 'x' : platform;
    assert.equal(targetSchema.safeParse({ platform: targetPlatform, accountId: 'account' }).success, supportsAnnouncement(platform), platform);
    assert.ok(publicationAvailability(platform));
  }
  assert.equal(supportsPostAction('discord'), true);
  assert.equal(supportsAnnouncement('discord'), false);
  for (const platform of ['instagram', 'tiktok', 'youtube', 'pinterest', 'snapchat', 'whatsapp', 'unknown']) {
    assert.equal(supportsPostAction(platform), false);
  }
});
