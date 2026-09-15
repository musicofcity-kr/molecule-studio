import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || 'evidence/sketcher-regression');
const browserChannel = process.env.BROWSER_CHANNEL || 'msedge';
const cases = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const footer = async (sketch) => (await sketch.locator('.sketch-footer').textContent()) || '';
async function atomCenter(atom) {
  const box = await atom.boundingBox();
  assert(box, 'atom is not measurable');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function run(name, body) {
  try { const details = await body(); cases.push({ name, status: 'passed', details }); console.log(`PASS: ${name}`); }
  catch (error) { cases.push({ name, status: 'failed', error: error instanceof Error ? error.message : String(error) }); console.log(`FAIL: ${name}: ${error}`); }
}

await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ channel: browserChannel, headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20_000);
  const initialResponse = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await initialResponse;
  await page.waitForFunction(() => !document.querySelector('.viewer-loading'));
  const sketch = page.locator('section.sketcher');
  await sketch.waitFor();
  const canvas = sketch.locator('svg.sketch-canvas');
  const reset = async () => {
    await sketch.getByRole('button', { name: '모두 지우기' }).click();
    await sketch.getByTitle('탄소 (C)', { exact: true }).click();
    await canvas.click({ position: { x: 85, y: 105 } });
    await sketch.getByTitle('산소 (O)', { exact: true }).click();
    await canvas.click({ position: { x: 240, y: 105 } });
    assert((await footer(sketch)).includes('2 atoms · 0 bonds'), 'reset did not create two atoms');
  };

  await run('click without movement does not add an undo entry', async () => {
    const reloadResponse = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await reloadResponse;
    await page.waitForFunction(() => !document.querySelector('.viewer-loading'));
    const undo = sketch.getByRole('button', { name: '되돌리기' });
    assert(await undo.isDisabled(), 'fresh externally supplied graph unexpectedly has undo history');
    await sketch.locator('.sketch-atom').first().click();
    assert(await undo.isDisabled(), 'click without movement added an undo entry');
    return { undoDisabled: true };
  });
  await run('blank-board hint text does not block atom placement', async () => {
    await sketch.getByRole('button', { name: '모두 지우기' }).click();
    const box = await canvas.boundingBox();
    assert(box, 'blank canvas is not measurable');
    // This is the SVG location of the empty-board hint, not an arbitrary blank area.
    await page.mouse.click(box.x + box.width * 190 / 380, box.y + box.height * 122 / 260);
    assert(await sketch.locator('.sketch-atom').count() === 1, 'clicking the empty-board hint did not add an atom');
    return { hintClickAddedAtom: true };
  });
  await run('F04 bond order is not visually selected in atom mode', async () => {
    await reset();
    assert(!await sketch.getByRole('button', { name: '단일', exact: true }).evaluate((node) => node.classList.contains('selected')), 'bond order is highlighted while atom mode is active');
    return { atomMode: true };
  });
  await run('F01 two-pixel second-atom movement still creates a bond', async () => {
    await sketch.getByRole('button', { name: '단일', exact: true }).click();
    await sketch.locator('.sketch-atom').nth(0).click();
    const second = await atomCenter(sketch.locator('.sketch-atom').nth(1));
    await page.mouse.move(second.x, second.y); await page.mouse.down(); await page.mouse.move(second.x + 2, second.y); await page.mouse.up();
    await page.waitForTimeout(50);
    assert((await footer(sketch)).includes('2 atoms · 1 bonds'), 'two-pixel pointer movement cancelled the second bond selection');
    return { bonds: 1 };
  });
  await run('F05 edits existing bond order and removes a bond without removing atoms', async () => {
    await sketch.getByRole('button', { name: '이중', exact: true }).click();
    await sketch.locator('.sketch-atom').nth(0).click();
    await sketch.locator('.sketch-atom').nth(1).click();
    assert(await sketch.locator('.bond-line').count() === 2, 'existing bond order was not updated to double');
    await sketch.getByRole('button', { name: '원자 또는 결합 삭제' }).click();
    const first = await atomCenter(sketch.locator('.sketch-atom').nth(0));
    const second = await atomCenter(sketch.locator('.sketch-atom').nth(1));
    await page.mouse.click((first.x + second.x) / 2, (first.y + second.y) / 2);
    assert((await footer(sketch)).includes('2 atoms · 0 bonds'), 'bond-only delete did not preserve atoms');
    return { atomsPreserved: 2 };
  });
  await run('F03 drag undo restores the pre-drag atom position', async () => {
    await reset();
    const atom = sketch.locator('.sketch-atom').nth(0);
    const before = await atom.locator('circle').getAttribute('cx');
    const center = await atomCenter(atom);
    await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 38, center.y + 2); await page.mouse.up();
    await page.waitForTimeout(50);
    assert(await atom.locator('circle').getAttribute('cx') !== before, 'drag did not move the atom');
    await sketch.getByRole('button', { name: '되돌리기' }).click();
    await page.waitForTimeout(50);
    assert(await atom.locator('circle').getAttribute('cx') === before, 'first undo did not restore pre-drag position');
    return { restoredCx: before };
  });
  await run('actual delayed graph analysis locks editing and removes the lock message when complete', async () => {
    await sketch.getByRole('button', { name: '결합 추가' }).click();
    await sketch.locator('.sketch-atom').nth(0).click();
    await sketch.locator('.sketch-atom').nth(1).click();
    const atomsBefore = await sketch.locator('.sketch-atom').count();
    let delayed = false;
    await page.route('**/api/molecule', async (route) => {
      const body = route.request().postDataJSON();
      if (!delayed && body?.graph) {
        delayed = true;
        // Intentional delay: verifies the UI while a real graph API request is pending.
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      await route.continue();
    });
    try {
      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST' && Boolean(response.request().postDataJSON()?.graph));
      await sketch.getByRole('button', { name: '3D 만들기' }).click();
      await page.waitForFunction(() => document.querySelector('section.sketcher button[aria-label="원자 추가"]')?.hasAttribute('disabled'));
      assert(await sketch.getByRole('button', { name: '결합 추가' }).isDisabled(), 'toolbar remained editable while graph analysis was pending');
      assert((await sketch.locator('.sketch-feedback').textContent())?.includes('잠깁니다'), 'loading feedback is missing');
      const box = await canvas.boundingBox();
      assert(box, 'canvas is not measurable during loading');
      await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.82);
      assert(await sketch.locator('.sketch-atom').count() === atomsBefore, 'canvas changed while graph analysis was pending');
      await responsePromise;
      await page.locator('.viewer-loading').waitFor({ state: 'detached' });
      assert(await sketch.getByRole('button', { name: '원자 추가' }).isEnabled(), 'toolbar did not unlock after graph analysis');
      assert(!((await sketch.locator('.sketch-feedback').textContent())?.includes('잠깁니다')), 'loading feedback remained after graph analysis');
      return { routeDelayMs: 350, toolbarLocked: true, canvasLocked: true };
    } finally {
      await page.unroute('**/api/molecule');
    }
  });
  await run('external molecule replacement clears editor undo history', async () => {
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST');
    await page.locator('#smiles').fill('O');
    await Promise.all([responsePromise, page.getByRole('button', { name: 'SMILES 분석', exact: true }).click()]);
    await page.waitForFunction(() => !document.querySelector('.viewer-loading') && document.querySelector('#smiles')?.value === 'O');
    assert(await sketch.getByRole('button', { name: '되돌리기' }).isDisabled(), 'external molecule replacement retained the previous undo history');
    return { undoDisabled: true };
  });
  await page.screenshot({ path: path.join(evidenceDir, 'sketcher-regression.png'), fullPage: true });
} finally {
  await browser.close();
}
const result = { baseUrl: BASE_URL, browserChannel, cases, passed: cases.filter((item) => item.status === 'passed').length, failed: cases.filter((item) => item.status === 'failed').length };
await writeFile(path.join(evidenceDir, 'sketcher-regression.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
process.exitCode = result.failed ? 1 : 0;
