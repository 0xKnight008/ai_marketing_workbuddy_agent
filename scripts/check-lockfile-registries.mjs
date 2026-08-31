import { readFile } from 'node:fs/promises';

const lockfiles = [
  'package-lock.json',
  'server/package-lock.json',
  'platform/package-lock.json',
  'ai-runtime/package-lock.json',
];
const allowedHosts = new Set(['registry.npmjs.org']);
const violations = [];

for (const lockfile of lockfiles) {
  const lock = JSON.parse(await readFile(lockfile, 'utf8'));

  for (const [packagePath, metadata] of Object.entries(lock.packages ?? {})) {
    if (!metadata || typeof metadata.resolved !== 'string') continue;

    let resolved;
    try {
      resolved = new URL(metadata.resolved);
    } catch {
      violations.push(`${lockfile}:${packagePath || '<root>'} has an invalid resolved URL`);
      continue;
    }

    if (resolved.protocol !== 'https:' || !allowedHosts.has(resolved.hostname)) {
      violations.push(`${lockfile}:${packagePath || '<root>'} resolves from ${resolved.origin}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Lockfiles contain package URLs outside the approved npm registry:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log('All package lockfiles resolve from the public npm registry.');
}
