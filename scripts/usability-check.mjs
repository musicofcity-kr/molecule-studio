import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.EVIDENCE_DIR || 'evidence/usability-fixes-20260915/browser');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const channel = process.env.BROWSER_CHANNEL || 'chrome';
const startedAt = new Date().toISOString();
const results = [];
await mkdir(root, { recursive: true });
for (const name of ['sketcher', 'workflow', 'viewer']) {
  const evidenceDir = path.join(root, name);
  await mkdir(evidenceDir, { recursive: true });
  const script = `scripts/browser-${name}-regression.mjs`;
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, BASE_URL: baseUrl, EVIDENCE_DIR: evidenceDir, BROWSER_CHANNEL: channel },
    encoding: 'utf8', timeout: 240_000, windowsHide: true,
  });
  await writeFile(path.join(evidenceDir, 'runner.stdout.log'), result.stdout || '');
  await writeFile(path.join(evidenceDir, 'runner.stderr.log'), result.stderr || '');
  const item = { suite: name, script, status: result.status === 0 ? 'passed' : 'failed', exitCode: result.status, signal: result.signal, error: result.error?.message ?? null };
  results.push(item);
  console.log(`${item.status.toUpperCase()}: ${name}`);
  if (result.status !== 0) console.log((result.stderr || result.stdout || result.error?.message || '').slice(-4500));
}
const report = { startedAt, finishedAt: new Date().toISOString(), baseUrl, browser: `${channel}/headless`, results, passed: results.every((item) => item.status === 'passed') };
await writeFile(path.join(root, 'usability-check.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.passed) process.exitCode = 1;
