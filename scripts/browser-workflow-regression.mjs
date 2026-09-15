import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || 'evidence/browser-workflow');
const cases = [];
const pageErrors = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
async function runCase(name, fn) {
  const startedAt = Date.now();
  try { const details = await fn(); cases.push({ name, status: 'passed', durationMs: Date.now() - startedAt, details }); console.log(`PASS: ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) }); console.log(`FAIL: ${name}: ${error}`); }
}
async function waitForAnalysis(page) {
  await page.locator('.viewer-loading').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
  await page.locator('.identity-panel h1').waitFor({ state: 'visible', timeout: 60_000 });
}
async function analyze(page, smiles) {
  await page.locator('#smiles').fill(smiles);
  const responsePromise = page.waitForResponse((item) => item.url().endsWith('/api/molecule') && item.request().postDataJSON()?.smiles === smiles, { timeout: 60_000 });
  const [response] = await Promise.all([responsePromise, page.getByRole('button', { name: 'SMILES 분석', exact: true }).click()]);
  assert(response.ok(), `SMILES ${smiles} API returned ${response.status()}`);
  await response.finished();
  const body = await response.json();
  const result = body?.molecule ?? body;
  const canonical = result?.smiles;
  assert(typeof canonical === 'string' && canonical.length > 0, `SMILES ${smiles} response has no canonical SMILES`);
  await page.waitForFunction((expected) => {
    const loading = document.querySelector('.viewer-loading');
    const resultSmiles = document.querySelector('.identity-panel .smiles-readonly code')?.textContent?.trim();
    return !loading && resultSmiles === expected;
  }, canonical, { timeout: 60_000 });
  await page.locator('.identity-panel h1').waitFor({ state: 'visible', timeout: 60_000 });
  return { response, canonical };
}

await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await waitForAnalysis(page);

  await runCase('F06 stale 2D and typed SMILES cannot save old analysis', async () => {
    const save = page.getByRole('button', { name: '현재 분자를 컬렉션에 저장' });
    assert(await save.isEnabled(), 'save should start enabled for analyzed molecule');
    await page.getByRole('button', { name: '원자 추가' }).click();
    const canvasBox = await page.locator('.sketch-canvas').boundingBox();
    assert(canvasBox, '2D sketch canvas is not measurable');
    await page.mouse.click(canvasBox.x + canvasBox.width * 0.9, canvasBox.y + canvasBox.height * 0.82);
    assert(await save.isDisabled(), 'structurally edited 2D graph did not block save');
    assert(await page.getByText('2D 구조의 원자 또는 결합이 마지막 3D 분석 결과와 다릅니다.').isVisible(), 'nearby stale explanation missing');
    assert(await page.getByRole('button', { name: '수정한 2D 구조로 3D 만들기' }).isVisible(), '2D conversion recovery missing');
    await analyze(page, 'CCO');
    await page.locator('#smiles').fill('CC');
    assert(await save.isDisabled(), 'unanalysed typed SMILES did not block save');
    assert(await page.getByRole('button', { name: '입력한 SMILES 분석하기' }).isVisible(), 'SMILES recovery action missing');
    await analyze(page, 'CCO');
    return { dirtyGraphBlocked: true, typedSmilesBlocked: true };
  });

  await runCase('F07 note drafts persist while measurements remain analysis scoped', async () => {
    const notes = page.getByRole('textbox', { name: '학습 노트' });
    await notes.fill('에탄올 세션 초안');
    await page.getByRole('button', { name: /^거리/ }).click();
    await page.locator('.atom-picker-list button').nth(0).click();
    await page.locator('.atom-picker-list button').nth(1).click();
    const record = page.getByRole('button', { name: '기록' });
    if (await record.isVisible()) await record.click();
    await analyze(page, 'CC(=O)O');
    assert(await notes.inputValue() === '', 'another molecule inherited the first note');
    assert(await page.locator('.saved-measurements').count() === 0, 'another molecule inherited measurements');
    await notes.fill('아세트산 세션 초안');
    await analyze(page, 'CCO');
    assert(await notes.inputValue() === '에탄올 세션 초안', 'returning to ethanol lost its note draft');
    assert(await page.locator('.saved-measurements').count() === 0, 'a new analysis restored measurements from old 3D coordinates');
    return { restoredNote: true, measurementsResetOnAnalysis: true };
  });

  await runCase('F08 collection Escape closes and restores focus', async () => {
    const trigger = page.getByRole('button', { name: /내 컬렉션/ });
    await trigger.focus(); await trigger.click();
    const dialog = page.getByRole('dialog', { name: '내 컬렉션' });
    await dialog.waitFor({ state: 'visible' });
    assert(await page.getByRole('button', { name: '닫기' }).evaluate((node) => node === document.activeElement), 'dialog did not place focus inside');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    assert(await trigger.evaluate((node) => node === document.activeElement), 'focus did not return to collection trigger');
    return { escapeClosed: true, focusRestored: true };
  });

  await runCase('F09 help exposes actionable workflow', async () => {
    await page.getByRole('button', { name: '사용법' }).click();
    const help = page.locator('#quick-help');
    const copy = await help.innerText();
    for (const phrase of ['첫 원자와 두 번째 원자', '단일·이중·삼중', '결합 삭제', '3D 만들기', '원자 선택 목록', '컬렉션']) assert(copy.includes(phrase), `help missing: ${phrase}`);
    assert(await help.evaluate((node) => node === document.activeElement), 'help action did not move focus to instructions');
    await page.screenshot({ path: path.join(evidenceDir, 'workflow-final.png'), fullPage: true });
    return { actionableHelp: true };
  });
} finally {
  await browser.close();
}

const summary = { baseUrl: BASE_URL, browserChannel: BROWSER_CHANNEL, generatedAt: new Date().toISOString(), cases, pageErrors, passed: cases.every((item) => item.status === 'passed') && pageErrors.length === 0 };
await writeFile(path.join(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
if (!summary.passed) process.exitCode = 1;
