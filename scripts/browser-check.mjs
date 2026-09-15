import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';
import { scienceBrowserCases } from './science-browser-cases.mjs';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || 'evidence/browser');
const startedAt = new Date().toISOString();
const cases = [];
const pageErrors = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function text(locator) {
  return (await locator.textContent())?.trim() || '';
}

async function verifyPngContent(page, target) {
  const dataUrl = `data:image/png;base64,${(await readFile(target)).toString('base64')}`;
  const details = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let dark = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0 && pixels[index] + pixels[index + 1] + pixels[index + 2] < 500) dark++;
    }
    return { width: canvas.width, height: canvas.height, darkFraction: dark / (canvas.width * canvas.height) };
  }, dataUrl);
  assert(details.width >= 1000 && details.height >= 500 && details.darkFraction > 0.005, `PNG has no meaningful content: ${JSON.stringify(details)}`);
  return details;
}

async function waitForMolecule(page, timeout = 60_000) {
  await page.locator('.viewer-stage canvas').waitFor({ state: 'attached', timeout });
  await page.locator('.viewer-loading').waitFor({ state: 'detached', timeout }).catch(() => {});
  await page.locator('.identity-panel h1').waitFor({ state: 'visible', timeout });
  await page.locator('[role="application"][aria-label="분자 3차원 구조 뷰어"] span').first().waitFor({ state: 'visible', timeout });
}

async function submitSmiles(page, smiles, timeout = 60_000) {
  await page.getByRole('button', { name: 'SMILES 분석', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.viewer-loading'));
  await page.locator('#smiles').fill(smiles);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST' && response.request().postDataJSON()?.smiles === smiles, { timeout });
  const [response] = await Promise.all([responsePromise, page.getByRole('button', { name: 'SMILES 분석', exact: true }).click()]);
  assert(response.ok(), `SMILES ${smiles} API returned ${response.status()}`);
  const body = await response.json();
  await page.waitForFunction((canonical) => document.querySelector('#smiles')?.value === canonical && !document.querySelector('.viewer-loading'), body.smiles, { timeout });
  await waitForMolecule(page, timeout);
  return response;
}

async function visibleAtomButton(page, id, element) {
  const pattern = new RegExp(`${id}번\\s+${element}\\s+원자 선택`);
  const pickerButtons = page.locator('.atom-picker button').filter({ hasText: new RegExp(`^${id}$`) });
  for (let index = 0; index < await pickerButtons.count(); index += 1) {
    const candidate = pickerButtons.nth(index);
    const box = await candidate.boundingBox().catch(() => null);
    if (box && box.width >= 20 && box.height >= 20 && await candidate.isVisible().catch(() => false)) return candidate;
  }
  const buttons = page.locator('.inspector').getByRole('button', { name: pattern });
  for (let index = 0; index < await buttons.count(); index += 1) {
    const candidate = buttons.nth(index);
    const box = await candidate.boundingBox().catch(() => null);
    if (box && box.width >= 20 && box.height >= 20 && await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function projectedAtomClick(page, id, element) {
  const viewer = page.locator('[role="application"][aria-label="분자 3차원 구조 뷰어"]');
  const label = viewer.locator('span').filter({ hasText: new RegExp(`^${id}\\s+·\\s+${element}$`) }).first();
  await label.waitFor({ state: 'visible', timeout: 15_000 });
  const labelBox = await label.boundingBox();
  const canvas = viewer.locator('canvas').first();
  const canvasBox = await canvas.boundingBox();
  assert(labelBox && canvasBox, `projected label or canvas is not measurable for atom ${id}`);
  await canvas.click({ position: {
    x: Math.max(1, Math.min(canvasBox.width - 1, labelBox.x + labelBox.width / 2 - canvasBox.x)),
    y: Math.max(1, Math.min(canvasBox.height - 1, labelBox.y + labelBox.height / 2 - canvasBox.y)),
  } });
}

async function selectAtom(page, id, element) {
  const allAtoms = page.getByRole('button', { name: '전체 원자', exact: true });
  if (element === 'H' && await allAtoms.count()) await allAtoms.click();
  const button = await visibleAtomButton(page, id, element);
  if (button) {
    await button.click();
    return 'visible-atom-button';
  }
  await projectedAtomClick(page, id, element);
  return 'projected-canvas';
}

async function setMode(page, mode) {
  const names = { inspect: /원자 보기/, distance: /^거리/, angle: /각도/ };
  await page.getByRole('button', { name: names[mode] }).click();
}

async function runCase(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    cases.push({ name, status: 'passed', durationMs: Date.now() - started, details: details ?? null });
    console.log(`PASS: ${name}`);
  } catch (error) {
    cases.push({ name, status: 'failed', durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL: ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await mkdir(evidenceDir, { recursive: true });
let browser;
let context;
let page;
try {
  browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  context = await browser.newContext({
    acceptDownloads: true,
    reducedMotion: 'reduce',
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

  await runCase('initial ethanol API and 3D canvas', async () => {
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST', { timeout: 60_000 });
    const [response] = await Promise.all([responsePromise, page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })]);
    assert(response.ok(), `initial molecule API returned ${response.status()}`);
    await response.finished();
    await waitForMolecule(page);
    assert((await text(page.locator('.identity-panel h1'))).length > 0, 'molecule identity is empty');
    assert(await page.locator('.viewer-stage canvas').count() === 1, 'Three.js canvas was not mounted');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-initial.png'), fullPage: true });
    return { status: response.status(), title: await text(page.locator('.identity-panel h1')) };
  });

  await runCase('atom labels toggle without losing atoms or measurement', async () => {
    const toggle = page.getByRole('checkbox', { name: '원자 라벨' });
    const labels = page.locator('.atom-label');
    assert(await toggle.isChecked() && await labels.count() > 0, 'labels should initially be visible');
    const labelBox = await labels.first().boundingBox();
    const canvas = page.locator('.viewer-stage canvas');
    const canvasBox = await canvas.boundingBox();
    const originalCanvas = await canvas.elementHandle();
    assert(labelBox && canvasBox, 'atom projection missing');
    await toggle.uncheck();
    assert(await labels.count() === 0, 'atom labels were not hidden');
    assert(await originalCanvas.evaluate((node) => node.isConnected), 'toggle replaced the 3D canvas');
    await canvas.click({ position: { x: labelBox.x + labelBox.width / 2 - canvasBox.x, y: labelBox.y + labelBox.height / 2 - canvasBox.y } });
    assert((await text(page.locator('.measurement-strip'))).includes('1/1'), 'hidden-label atom is not clickable');
    await setMode(page, 'distance');
    await page.locator('.atom-picker-list button').nth(0).click();
    await page.locator('.atom-picker-list button').nth(1).click();
    assert((await text(page.locator('.measurement-strip'))).includes('Å'), 'measurement failed with hidden labels');
    await page.screenshot({ path: path.join(evidenceDir, 'desktop-labels-hidden.png'), fullPage: true });
    await toggle.check();
    assert(await labels.count() > 0, 'labels were not restored');
    await page.getByRole('checkbox', { name: 'H 표시', exact: true }).uncheck();
    assert(!(await labels.allTextContents()).some((label) => /· H$/.test(label)), 'hydrogen visibility is not independent');
    await page.getByRole('checkbox', { name: 'H 표시', exact: true }).check();
    await setMode(page, 'inspect');
    return { hiddenLabelSelection: true, hiddenLabelMeasurement: true, canvasPreserved: true };
  });

  await runCase('real projected canvas atom click', async () => {
    await setMode(page, 'inspect');
    await projectedAtomClick(page, 1, 'C');
    await page.locator('.inspector .vsepr, .inspector .muted').first().waitFor({ state: 'visible' });
    assert(await page.locator('.inspector .vsepr').count() > 0, 'canvas atom click did not select a supported carbon center');
    return { selectionRoute: 'projected-canvas' };
  });

  await runCase('water central oxygen through visible atom control or canvas', async () => {
    await submitSmiles(page, 'O');
    await setMode(page, 'inspect');
    const route = await selectAtom(page, 0, 'O');
    assert((await text(page.locator('.inspector'))).includes('AX2E2'), 'central oxygen did not resolve to AX2E2');
    return { selectionRoute: route, vsepr: await text(page.locator('.inspector .vsepr-symbol')) };
  });

  await runCase('water H/O distance measurement', async () => {
    await setMode(page, 'distance');
    const firstRoute = await selectAtom(page, 0, 'O');
    const secondRoute = await selectAtom(page, 1, 'H');
    const value = page.locator('.measurement-strip b').filter({ hasText: /Å/ });
    await value.waitFor({ state: 'visible', timeout: 10_000 });
    const label = await text(value);
    const numeric = Number(label.match(/([0-9]+(?:\.[0-9]+)?)\s*Å/)?.[1]);
    assert(Number.isFinite(numeric) && numeric >= 0.9 && numeric <= 1.1, `distance is outside expected O-H range: ${label}`);
    return { label, routes: [firstRoute, secondRoute] };
  });

  await runCase('water H/O/H angle measurement', async () => {
    await setMode(page, 'angle');
    const routes = [await selectAtom(page, 1, 'H'), await selectAtom(page, 0, 'O'), await selectAtom(page, 2, 'H')];
    const value = page.locator('.measurement-strip b').filter({ hasText: /°/ });
    await value.waitFor({ state: 'visible', timeout: 10_000 });
    const label = await text(value);
    const numeric = Number(label.match(/([0-9]+(?:\.[0-9]+)?)°/)?.[1]);
    assert(Number.isFinite(numeric) && numeric >= 100 && numeric <= 115, `angle is outside expected water range: ${label}`);
    return { label, routes };
  });

  await runCase('orbital disclaimer and schematic toggle', async () => {
    await setMode(page, 'inspect');
    await selectAtom(page, 0, 'O');
    const orbitals = page.getByRole('checkbox', { name: '오비탈' });
    await orbitals.check();
    const notice = page.getByText(/혼성 오비탈 개념도 · 양자화학 계산 아님/);
    await notice.waitFor({ state: 'visible', timeout: 10_000 });
    return { notice: await text(notice) };
  });

  await runCase('spectra tabs render educational data', async () => {
    const tabs = page.getByRole('tab');
    assert(await tabs.count() >= 3, 'spectra tabs are missing');
    const nmr = page.getByRole('tab', { name: '13C NMR' });
    await nmr.click();
    assert((await text(page.locator('.spectra .spectrum-name'))).includes('NMR'), '13C NMR tab did not render');
    return { tabCount: await tabs.count(), active: await text(page.locator('.spectra .spectrum-name')) };
  });

  await runCase('invalid SMILES displays safe request error', async () => {
    await page.locator('#smiles').fill('C1=');
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().postDataJSON()?.smiles === 'C1=', { timeout: 60_000 });
    const [response] = await Promise.all([responsePromise, page.getByRole('button', { name: 'SMILES 분석', exact: true }).click()]);
    assert(response.status() === 400, `invalid SMILES returned ${response.status()}`);
    const banner = page.locator('.error-banner');
    await banner.waitFor({ state: 'visible', timeout: 10_000 });
    const message = await text(banner);
    assert(message && !message.includes('[object Object]'), `unsafe error text: ${message}`);
    await submitSmiles(page, 'O');
    return { message };
  });

  await runCase('charged molecule survives editor round trip', async () => {
    const before = await (await submitSmiles(page, '[NH4+]')).json();
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST');
    const [response] = await Promise.all([responsePromise, page.getByRole('button', { name: '3D 만들기' }).click()]);
    assert(response.ok(), `charged graph returned ${response.status()}`);
    const after = await response.json();
    assert(after.smiles === before.smiles && after.formula === before.formula, `charged molecule changed: ${before.smiles} -> ${after.smiles}`);
    assert(after.atoms.some((atom) => atom.element === 'N' && atom.charge === 1), 'ammonium charge was lost');
    await waitForMolecule(page);
    return { smiles: after.smiles, formula: after.formula };
  });

  await runCase('expanded element palette draws H B Si I through the real API', async () => {
    const sketch = page.locator('section.sketcher');
    assert(await sketch.locator('.element-row button').count() === 12, 'expected 12 element choices');
    const results = [];
    for (const [symbol, name, partner, partnerName] of [
      ['H', '수소', 'O', '산소'], ['B', '붕소', 'F', '플루오린'],
      ['Si', '규소', 'C', '탄소'], ['I', '아이오딘', 'C', '탄소'],
    ]) {
      await sketch.getByRole('button', { name: '모두 지우기' }).click();
      await sketch.getByTitle(`${name} (${symbol})`, { exact: true }).click();
      await sketch.locator('.sketch-canvas').click({ position: { x: 90, y: 105 } });
      assert((await text(sketch.locator('.sketch-atom text').first())) === symbol, `${symbol} was not drawn`);
      if (symbol === 'H') assert(await sketch.locator('.sketch-atom text').first().evaluate((node) => getComputedStyle(node).fill) === 'rgb(51, 65, 85)', 'H text lacks contrast');
      await sketch.getByTitle(`${partnerName} (${partner})`, { exact: true }).click();
      await sketch.locator('.sketch-canvas').click({ position: { x: 240, y: 105 } });
      await sketch.getByRole('button', { name: '단일', exact: true }).click();
      await sketch.locator('.sketch-atom').nth(0).click();
      await sketch.locator('.sketch-atom').nth(1).click();
      const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST');
      const [response] = await Promise.all([responsePromise, sketch.getByRole('button', { name: '3D 만들기' }).click()]);
      assert(response.ok(), `${symbol} graph returned ${response.status()}`);
      const body = await response.json();
      assert(body.atoms.some((atom) => atom.element === symbol), `${symbol} lost in conversion`);
      assert(body.svg.includes('<svg') && body.bonds.length > 0, `${symbol} depiction missing`);
      await waitForMolecule(page);
      results.push({ element: symbol, formula: body.formula, method: body.method });
    }
    await sketch.getByTitle('탄소 (C)', { exact: true }).click();
    return results;
  });

  await runCase('draw two atoms, add bond, and convert through API', async () => {
    const sketch = page.locator('section.sketcher');
    await sketch.getByRole('button', { name: '모두 지우기' }).click();
    await sketch.locator('svg.sketch-canvas').click({ position: { x: 90, y: 105 } });
    await sketch.locator('svg.sketch-canvas').click({ position: { x: 250, y: 105 } });
    assert((await text(sketch.locator('.sketch-footer'))).includes('2 atoms · 0 bonds'), 'two drawn atoms were not created');
    await sketch.getByRole('button', { name: '결합 추가' }).click();
    await sketch.locator('.sketch-atom').nth(0).click();
    await sketch.locator('.sketch-atom').nth(1).click();
    assert((await text(sketch.locator('.sketch-footer'))).includes('2 atoms · 1 bonds'), 'drawn bond was not created');
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST');
    const [response] = await Promise.all([responsePromise, sketch.getByRole('button', { name: '3D 만들기' }).click()]);
    assert(response.ok(), `graph conversion API returned ${response.status()}`);
    await waitForMolecule(page);
    return { status: response.status(), title: await text(page.locator('.identity-panel h1')) };
  });

  await runCase('collection note save and load', async () => {
    const note = 'browser integration evidence note';
    await page.getByRole('textbox', { name: '학습 노트' }).fill(note);
    await page.getByRole('button', { name: '현재 분자를 컬렉션에 저장' }).click();
    await page.locator('.collection-modal').waitFor({ state: 'visible', timeout: 10_000 });
    assert(await page.locator('.collection-load').count() > 0 && (await page.locator('.collection-load strong').first().textContent())?.trim(), 'saved collection entry is missing its name or formula');
    await page.locator('.collection-load').first().click();
    assert(await page.getByRole('textbox', { name: '학습 노트' }).inputValue() === note, 'saved note was not restored');
    return { note };
  });

  await runCase('study card PNG download', async () => {
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    const [download] = await Promise.all([downloadPromise, page.getByRole('button', { name: '학습 카드' }).click()]);
    const target = path.join(evidenceDir, 'study-card.png');
    await download.saveAs(target);
    const bytes = (await stat(target)).size;
    assert(bytes > 1000, `study-card PNG is unexpectedly small: ${bytes} bytes`);
    return { file: target, bytes, pixels: await verifyPngContent(page, target) };
  });

  await scienceBrowserCases({ page, runCase, submitSmiles, setMode, selectAtom, waitForMolecule, verifyPngContent, evidenceDir });

  await page.setViewportSize({ width: 390, height: 844 });
  await runCase('mobile water measurement, orbitals, and PNG', async () => {
    await submitSmiles(page, 'O');
    const labelsToggle = page.getByRole('checkbox', { name: '원자 라벨' });
    assert(await labelsToggle.isVisible(), 'label control is hidden on mobile');
    await labelsToggle.uncheck();
    assert(await page.locator('.atom-label').count() === 0, 'mobile labels did not hide');
    await setMode(page, 'angle');
    await selectAtom(page, 1, 'H');
    await selectAtom(page, 0, 'O');
    await selectAtom(page, 2, 'H');
    const angle = await text(page.locator('.measurement-strip b').filter({ hasText: /°/ }));
    const numeric = Number(angle.match(/([0-9]+(?:\.[0-9]+)?)°/)?.[1]);
    assert(numeric >= 100 && numeric <= 115, `mobile water angle incorrect: ${angle}`);
    await setMode(page, 'inspect');
    await selectAtom(page, 0, 'O');
    assert((await text(page.locator('.inspector'))).includes('AX2E2'), 'mobile VSEPR missing');
    const ends = await page.locator('.vsepr-diagram svg g line').evaluateAll((lines) => lines.map((line) => [Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))]));
    assert(ends.length === 2 && (ends[0][0] - 50) * (ends[1][1] - 50) !== (ends[1][0] - 50) * (ends[0][1] - 50), 'water VSEPR schematic is collinear');
    await page.getByRole('checkbox', { name: '오비탈' }).check();
    await page.getByText(/혼성 오비탈 개념도 · 양자화학 계산 아님/).waitFor({ state: 'visible' });
    await labelsToggle.check();
    assert(await page.locator('.atom-label').count() === 3, 'mobile water labels did not restore');
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
    const [download] = await Promise.all([downloadPromise, page.getByRole('button', { name: '학습 카드' }).click()]);
    const target = path.join(evidenceDir, 'mobile-study-card.png');
    await download.saveAs(target);
    assert((await stat(target)).size > 1000, 'mobile study card is empty');
    return { angle, vsepr: 'AX2E2', png: target, pixels: await verifyPngContent(page, target) };
  });
  assert(await page.getByRole('button', { name: 'SMILES 분석', exact: true }).isVisible(), 'SMILES control is not visible on mobile');
  assert(await page.getByRole('checkbox', { name: 'H 표시' }).isVisible(), 'hydrogen control is not visible on mobile');
  const mobileWidth = await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: document.documentElement.clientWidth }));
  assert(mobileWidth.body <= mobileWidth.viewport + 1, `mobile horizontal overflow: ${JSON.stringify(mobileWidth)}`);
  await page.screenshot({ path: path.join(evidenceDir, 'mobile-final.png'), fullPage: true });
} catch (error) {
  cases.push({ name: 'runner setup', status: 'failed', durationMs: 0, error: error instanceof Error ? error.message : String(error) });
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}

if (pageErrors.length) cases.push({ name: 'uncaught browser errors', status: 'failed', durationMs: 0, error: pageErrors.join('\n') });
const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  baseUrl: BASE_URL,
  browser: 'msedge/headless',
  cases,
  pageErrors,
  passed: cases.length > 0 && cases.every((item) => item.status === 'passed'),
};
await writeFile(path.join(evidenceDir, 'browser-check.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
