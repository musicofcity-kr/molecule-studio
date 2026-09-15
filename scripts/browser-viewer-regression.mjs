import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || 'evidence/browser-viewer-regression');
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'msedge';
const cases = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function clickProjectedAtom(page, id, element) {
  const label = page.locator('.atom-label').filter({ hasText: new RegExp(`^${id} \\u00b7 ${element}$`) });
  await label.waitFor({ state: 'visible' });
  const labelBox = await label.boundingBox();
  const canvas = page.locator('.viewer-stage canvas');
  const canvasBox = await canvas.boundingBox();
  assert(labelBox && canvasBox, `projection missing for ${id} ${element}`);
  await canvas.click({
    position: {
      x: labelBox.x + labelBox.width / 2 - canvasBox.x,
      y: labelBox.y + labelBox.height / 2 - canvasBox.y,
    },
  });
}

async function projectedCanvasPosition(page, id, element) {
  const label = page.locator('.atom-label').filter({ hasText: new RegExp(`^${id} \\u00b7 ${element}$`) });
  await label.waitFor({ state: 'visible' });
  const labelBox = await label.boundingBox();
  const canvasBox = await page.locator('.viewer-stage canvas').boundingBox();
  assert(labelBox && canvasBox, `projection missing for ${id} ${element}`);
  return {
    x: labelBox.x + labelBox.width / 2 - canvasBox.x,
    y: labelBox.y + labelBox.height / 2 - canvasBox.y,
  };
}

async function clickCanvasPosition(page, position) {
  await page.locator('.viewer-stage canvas').click({ position });
}

async function saveStudyCardImage(page, filename) {
  const record = page.getByRole('button', { name: '기록', exact: true });
  await record.click();
  const savedMeasurements = page.locator('.saved-measurements');
  const savedText = await savedMeasurements.textContent();
  assert(/H1.*O0.*H2|H1.*O0|O0.*H2/.test(savedText || ''), `recorded measurement IDs missing: ${savedText}`);
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
  await page.getByRole('button', { name: /학습 카드/ }).click();
  const download = await downloadPromise;
  const target = path.join(evidenceDir, filename);
  await download.saveAs(target);
  const bytes = await (await import('node:fs/promises')).stat(target);
  assert(bytes.size > 1000, `capture PNG is unexpectedly small: ${bytes.size}`);
  return { file: target, bytes: bytes.size, recordedMeasurement: savedText?.trim() };
}

await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.locator('.viewer-stage canvas').waitFor({ state: 'attached' });
  const smiles = page.locator('#smiles');
  await smiles.fill('O');
  await page.getByRole('button', { name: 'SMILES 분석', exact: true }).click();
  await page.locator('.viewer-loading').waitFor({ state: 'detached', timeout: 60_000 }).catch(() => {});
  await page.locator('.atom-label').filter({ hasText: /^0 · O$/ }).waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: /각도/ }).click();

  // All three events are direct canvas clicks at the currently projected label
  // positions. The final click occurs after two selected outlines are present.
  await clickProjectedAtom(page, 1, 'H');
  await clickProjectedAtom(page, 0, 'O');
  await clickProjectedAtom(page, 2, 'H');
  const measurement = await page.locator('.measurement-strip').textContent();
  assert(/104|105|106|107|108|109|110|111|112|113|114/.test(measurement || ''), `water angle missing: ${measurement}`);
  await page.screenshot({ path: path.join(evidenceDir, 'water-direct-canvas.png'), fullPage: true });
  cases.push({ name: 'water H1-O0-H2 direct projected canvas clicks', status: 'passed', measurement: measurement?.trim() });

  const capture = await saveStudyCardImage(page, 'water-study-card-labels.png');
  const imageSrc = await page.locator('.study-visual img[alt="3D 분자 구조"]').getAttribute('src');
  assert(imageSrc?.startsWith('data:image/png'), 'study card did not receive a PNG capture');
  cases.push({ name: 'capture includes projected atom labels', status: 'passed', capture });

  // Choose angle again to clear selection, then exercise the same canvas
  // picking path after a small real OrbitControls rotation and zoom.
  await page.getByRole('button', { name: /각도/ }).click();
  const canvas = page.locator('.viewer-stage canvas');
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, 'canvas is not measurable after water reload');
  const initialPositions = [
    await projectedCanvasPosition(page, 1, 'H'),
    await projectedCanvasPosition(page, 0, 'O'),
    await projectedCanvasPosition(page, 2, 'H'),
  ];
  const blankX = canvasBox.x + canvasBox.width * 0.82;
  const blankY = canvasBox.y + canvasBox.height * 0.22;
  await page.mouse.move(blankX, blankY);
  await page.mouse.down();
  await page.mouse.move(blankX + 28, blankY + 12, { steps: 5 });
  await page.mouse.up();
  await page.mouse.wheel(0, -80);
  await page.waitForTimeout(400);
  const rotatedPositions = [
    await projectedCanvasPosition(page, 1, 'H'),
    await projectedCanvasPosition(page, 0, 'O'),
    await projectedCanvasPosition(page, 2, 'H'),
  ];
  const projectionDelta = Math.max(...rotatedPositions.map((position, index) => Math.hypot(position.x - initialPositions[index].x, position.y - initialPositions[index].y)));
  assert(projectionDelta > 3, `camera motion did not change projected coordinates: ${projectionDelta}`);
  for (const position of rotatedPositions) await clickCanvasPosition(page, position);
  const rotatedMeasurement = await page.locator('.measurement-strip').textContent();
  assert(/104|105|106|107|108|109|110|111|112|113|114/.test(rotatedMeasurement || ''), `rotated water angle missing: ${rotatedMeasurement}`);
  cases.push({ name: 'water direct canvas clicks after rotation and zoom', status: 'passed', measurement: rotatedMeasurement?.trim() });

  // Hide HTML labels and reuse their last projected canvas coordinates. This
  // proves labels are a visual aid and do not provide the click target.
  await page.getByRole('checkbox', { name: '원자 라벨' }).uncheck();
  assert(await page.locator('.atom-label').count() === 0, 'atom labels did not hide');
  // Clear the selection while labels remain hidden, then briefly show labels
  // only to record the exact current projection coordinates.
  await page.getByRole('button', { name: /각도/ }).click();
  await page.getByRole('checkbox', { name: '원자 라벨' }).check();
  await page.locator('.atom-label').filter({ hasText: /^0 · O$/ }).waitFor({ state: 'visible' });
  const hiddenTestPositions = [
    await projectedCanvasPosition(page, 1, 'H'),
    await projectedCanvasPosition(page, 0, 'O'),
    await projectedCanvasPosition(page, 2, 'H'),
  ];
  await page.getByRole('checkbox', { name: '원자 라벨' }).uncheck();
  for (const position of hiddenTestPositions) await clickCanvasPosition(page, position);
  const hiddenMeasurement = await page.locator('.measurement-strip').textContent();
  assert(/104|105|106|107|108|109|110|111|112|113|114/.test(hiddenMeasurement || ''), `hidden-label water angle missing: ${hiddenMeasurement}`);
  cases.push({ name: 'water direct canvas clicks with labels hidden', status: 'passed', measurement: hiddenMeasurement?.trim() });

} catch (error) {
  cases.push({ name: 'viewer regression', status: 'failed', error: error instanceof Error ? error.message : String(error) });
} finally {
  await page.close().catch(() => {});
  await browser.close();
}

const report = { baseUrl: BASE_URL, browser: `${BROWSER_CHANNEL}/headless`, cases, passed: cases.every((item) => item.status === 'passed') };
await writeFile(path.join(evidenceDir, 'browser-viewer-regression.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
