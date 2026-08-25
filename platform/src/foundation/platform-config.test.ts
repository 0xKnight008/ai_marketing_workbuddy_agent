import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGatewayConfig, loadWorkerConfig } from './platform-config';

const gatewayEnvironment = {
  DATABASE_URL: 'postgres://user:password@localhost:5432/piggybot',
  AUTH_TOKEN_SECRET: 'a'.repeat(32),
  AI_RUNTIME_EVENT_SIGNING_SECRET: 'b'.repeat(32),
};

const workerEnvironment = {
  DATABASE_URL: 'postgres://user:password@localhost:5432/piggybot',
  AI_RUNTIME_URL: 'http://localhost:4111',
  INTERNAL_SERVICE_TOKEN: 'internal-token',
};

test('Zernio client RPM defaults to the current safe allocation and accepts plan changes', () => {
  assert.equal(loadGatewayConfig(gatewayEnvironment).ZERNIO_CLIENT_RPM, 480);
  assert.equal(loadWorkerConfig({ ...workerEnvironment, ZERNIO_CLIENT_RPM: '960' }).ZERNIO_CLIENT_RPM, 960);
});

test('Zernio client RPM rejects unsafe values', () => {
  assert.throws(
    () => loadWorkerConfig({ ...workerEnvironment, ZERNIO_CLIENT_RPM: '0' }),
    /greater than or equal to 1/,
  );
});
