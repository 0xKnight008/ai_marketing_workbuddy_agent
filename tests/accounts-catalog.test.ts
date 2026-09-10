import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/pages/PlatformDashboard.tsx', import.meta.url), 'utf8');
test('Accounts advertises the 14 current social destinations excluding requested removals', () => {
  const catalog = source.slice(source.indexOf('const socialPlatforms ='), source.indexOf('function freshDraft'));
  for (const platform of ['facebook', 'instagram', 'linkedin', 'pinterest', 'googlebusiness', 'twitter', 'tiktok', 'youtube', 'threads', 'reddit', 'bluesky', 'discord', 'slack', 'telegram']) assert.ok(catalog.includes(`['${platform}'`));
  assert.doesNotMatch(catalog, /snapchat|whatsapp/);
});
test('the OAuth window is reserved before awaiting the API and failures release connecting state', () => {
  const connect = source.slice(source.indexOf('async function connectSocial'), source.indexOf('function startTemplate'));
  assert.ok(connect.indexOf('window.open(') < connect.indexOf('await fetch('));
  assert.match(connect, /finally \{ setConnecting\(''\); \}/);
  assert.match(connect, /popup\?\.close\(\)/);
});
