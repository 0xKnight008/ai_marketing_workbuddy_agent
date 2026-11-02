/** One-time release cutover. Run only after metering:check with cost-v1 succeeds. */
import { realpathSync, readFileSync, writeFileSync, statSync, copyFileSync, renameSync, chownSync, chmodSync, unlinkSync, constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
export const policyVersion = 'cost-106-v1';
function value(text, key) {
  const lines = text.split(/\r?\n/).filter(line => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line));
  if (lines.length > 1) throw new Error('duplicate_pricing_configuration');
  return (lines[0]?.split('=').slice(1).join('=').trim() ?? '').replace(/^(['"])(.*?)\1(?:\s*#.*)?$/, '$2').replace(/\s+#.*$/, '');
}
export function activation(text) {
  const marker = value(text, 'AI_CREDIT_ROLLOUT_VERSION');
  if (marker === policyVersion) return null; // respects later operator rollback to shadow/legacy
  if (marker) throw new Error('unexpected_pricing_rollout_version');
  const mode = value(text, 'AI_METERING_MODE');
  if (mode && !['legacy','shadow','cost-v1'].includes(mode)) throw new Error('invalid_ai_metering_mode');
  const remaining = text.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?(?:AI_METERING_MODE|AI_CREDIT_ROLLOUT_VERSION)\s*=/.test(line)).join('\n').trimEnd();
  return `${remaining}\nAI_METERING_MODE=cost-v1\nAI_CREDIT_ROLLOUT_VERSION=${policyVersion}\n`;
}
export function activateFile(path) {
  const original = readFileSync(path, 'utf8'), next = activation(original);
  if (next === null) return '';
  const st = statSync(path);
  const backup = `${path}.before-${policyVersion}-${Date.now()}`;
  copyFileSync(path, backup, constants.COPYFILE_EXCL);
  chmodSync(backup, 0o600);
  const temp = `${path}.cost106-${process.pid}`;
  try {
    writeFileSync(temp, next, { mode: 0o600, flag: 'wx' });
    chownSync(temp, st.uid, st.gid);
    chmodSync(temp, st.mode & 0o777);
    renameSync(temp, path);
  } finally { try { unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return backup;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, path] = process.argv.slice(2);
    if (!path || !['--status','--activate'].includes(action)) throw new Error('invalid_arguments');
    if (action === '--status') console.log(activation(readFileSync(path,'utf8')) === null ? 'applied' : 'pending');
    else console.log(activateFile(path));
  } catch { console.error('AI pricing cutover failed; inspect protected configuration without exposing secrets.'); process.exitCode=1; }
}
