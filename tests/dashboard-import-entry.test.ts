import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages/PlatformDashboard.tsx', import.meta.url), 'utf8');

test('paste imports with an empty title are blocked locally with a visible hint', () => {
  assert.match(source, /Give this import a title first/);
  // label 护栏必须发生在请求发出之前（setImportBusy 之前 return）。
  const guard = source.indexOf('Give this import a title first');
  const busy = source.indexOf('setImportBusy(true);', source.indexOf('async function createImport'));
  assert.ok(guard > 0 && guard < busy);
});

test('import failures surface the server-provided actionable message', () => {
  assert.match(source, /result\.message \?\? result\.error/);
});
