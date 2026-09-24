import assert from 'node:assert/strict';
import test from 'node:test';
import { PlatformService } from '../egg/platform-service';
import { HttpError } from '../http/errors';

test('verified Google callback distinguishes missing locations from consent denial without syncing', async () => {
  const service = Object.create(PlatformService.prototype) as PlatformService;
  Object.assign(service, {
    zernioClient: () => ({ verifyState: (value: string) => {
      assert.equal(value, 'test-state');
      return { workspaceId: 'workspace', profileId: 'profile', platform: 'googlebusiness' };
    }, listAccounts: () => assert.fail('must not sync failed authorization') }),
    zernioProfile: async () => 'profile',
  });
  await assert.rejects(service.completeZernioOAuth({ state: 'test-state', error: 'no_google_locations' }), error =>
    error instanceof HttpError && error.code === 'google_business_no_locations' && error.statusCode === 409 && error.message.includes('owns or manages'));
  await assert.rejects(service.completeZernioOAuth({ state: 'test-state', error: 'access_denied' }), /zernio_connection_denied/);
  await assert.rejects(service.completeZernioOAuth({ error: 'no_google_locations' }), /invalid_request/);
});
