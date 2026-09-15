import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const BROWSER_CHANNEL = process.env.BROWSER_CHANNEL || 'chrome';
const evidenceDir = path.resolve(process.env.EVIDENCE_DIR || 'evidence/browser-naming-regression');
const caseFilter = process.env.NAMING_CASE_FILTER || '';
const cases = [];
const pageErrors = [];

function assert(condition, message) { if (!condition) throw new Error(message); }
function available(smiles, { iupacName, commonName = null, cid }) {
  return { smiles, status: 'available', iupacName, commonName, source: 'PubChem', sourceUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`, cid };
}
function unavailable(smiles, status) { return { smiles, status, iupacName: null, commonName: null, source: null, sourceUrl: null, cid: null }; }
async function fulfill(route, body) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }

async function waitForStructure(page, response) {
  assert(response.ok(), `structure API returned ${response.status()}`);
  await response.finished();
  const raw = await response.json();
  const molecule = raw?.molecule ?? raw;
  assert(typeof molecule?.smiles === 'string' && Array.isArray(molecule.atoms), 'structure API response is malformed');
  await page.waitForFunction(({ smiles, atomCount }) => {
    const current = document.querySelector('.smiles-readonly code')?.textContent?.trim();
    const renderedAtoms = document.querySelectorAll('[aria-label="원자 선택"] button').length;
    return !document.querySelector('.viewer-loading') && current === smiles && renderedAtoms === atomCount;
  }, { smiles: molecule.smiles, atomCount: molecule.atoms.length }, { timeout: 60_000 });
  return molecule;
}

async function openApp(page) {
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST', { timeout: 60_000 });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const molecule = await waitForStructure(page, await responsePromise);
  await page.locator('.viewer-stage canvas').waitFor({ state: 'visible', timeout: 60_000 });
  return molecule;
}

async function submitStructure(page, smiles) {
  await page.locator('#smiles').fill(smiles);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().postDataJSON()?.smiles === smiles, { timeout: 60_000 });
  await page.getByRole('button', { name: 'SMILES 분석', exact: true }).click();
  return waitForStructure(page, await responsePromise);
}

async function recordDistance(page) {
  await page.getByRole('button', { name: /^거리/ }).click();
  const atoms = page.locator('.atom-picker-list button');
  assert(await atoms.count() >= 2, 'two atom controls are required for distance');
  await atoms.nth(0).click(); await atoms.nth(1).click();
  const label = (await page.locator('.measurement-strip b').textContent())?.trim();
  assert(label?.includes('Å'), `distance is missing: ${label}`);
  await page.getByRole('button', { name: '기록', exact: true }).click();
  assert(await page.locator('.saved-measurements span').count() === 1, 'distance was not recorded');
  return label;
}

async function retryNaming(page) {
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/molecule?lookup=name') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '다시 확인', exact: true }).click();
  await page.locator('.naming-status .spin').waitFor({ state: 'visible' });
  const response = await responsePromise;
  assert(response.ok(), `name retry returned ${response.status()}`);
  await response.finished();
  await page.waitForFunction(() => !document.querySelector('.naming-status .spin'));
}

async function runCase(browser, name, body, options = {}) {
  if (caseFilter && !name.includes(caseFilter)) return;
  const startedAt = Date.now();
  const context = await browser.newContext({ acceptDownloads: true, viewport: options.viewport ?? { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on('pageerror', (error) => pageErrors.push({ case: name, error: error.stack || error.message }));
  try {
    const details = await body(page, context);
    cases.push({ name, status: 'passed', durationMs: Date.now() - startedAt, details });
    console.log(`PASS: ${name}`);
  } catch (error) {
    cases.push({ name, status: 'failed', durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
    console.log(`FAIL: ${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}

await mkdir(evidenceDir, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: BROWSER_CHANNEL, headless: true, args: ['--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });

  await runCase(browser, '3D and measurement remain stable while naming is gated', async (page) => {
    let releaseName;
    const nameGate = new Promise((resolve) => { releaseName = resolve; });
    await page.route('**/api/molecule?lookup=name', async (route) => { await nameGate; await fulfill(route, available('CCO', { commonName: '에탄올', iupacName: 'ethanol', cid: 702 })); });
    const molecule = await openApp(page);
    assert(molecule.smiles === 'CCO', `unexpected initial molecule: ${molecule.smiles}`);
    await page.locator('.identity-panel').getByText('IUPAC 이름 확인 중', { exact: true }).waitFor({ state: 'visible' });
    const distance = await recordDistance(page);
    await page.locator('.viewer-stage canvas').scrollIntoViewIfNeeded();
    const label = page.locator('.atom-label').first();
    const before = await label.boundingBox();
    const canvas = await page.locator('.viewer-stage canvas').boundingBox();
    assert(before && canvas, 'camera projection is not measurable');
    await page.mouse.move(canvas.x + canvas.width * 0.82, canvas.y + canvas.height * 0.22);
    await page.mouse.down(); await page.mouse.move(canvas.x + canvas.width * 0.9, canvas.y + canvas.height * 0.29, { steps: 6 }); await page.mouse.up();
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(900);
    const moved = await label.boundingBox();
    assert(moved && Math.hypot(moved.x - before.x, moved.y - before.y) > 3, 'camera movement did not change atom projection');
    releaseName();
    await page.locator('.identity-panel h1').filter({ hasText: /^에탄올$/ }).waitFor();
    await page.locator('.identity-panel .iupac-name').filter({ hasText: /ethanol/ }).waitFor();
    const after = await label.boundingBox();
    assert(after && Math.hypot(after.x - moved.x, after.y - moved.y) < 2, 'name response reset the camera projection');
    assert(await page.locator('.atom-picker-list button.selected').count() === 2, 'name response cleared atom selection');
    assert((await page.locator('.saved-measurements').textContent())?.includes(distance), 'name response cleared recorded distance');
    return { realStructurePost: true, atoms: molecule.atoms.length, distance, projectionDeltaAfterName: Math.hypot(after.x - moved.x, after.y - moved.y) };
  });

  await runCase(browser, 'late ethanol name cannot replace newer water name', async (page) => {
    let releaseEthanol;
    const ethanolGate = new Promise((resolve) => { releaseEthanol = resolve; });
    await page.route('**/api/molecule?lookup=name', async (route) => {
      const { smiles } = route.request().postDataJSON();
      if (smiles === 'CCO') { await ethanolGate; await fulfill(route, available('CCO', { commonName: '에탄올', iupacName: 'ethanol', cid: 702 })).catch(() => {}); return; }
      assert(smiles === 'O', `unexpected naming request: ${smiles}`);
      await fulfill(route, available('O', { commonName: '물', iupacName: 'oxidane', cid: 962 }));
    });
    await openApp(page);
    const water = await submitStructure(page, 'O');
    assert(water.formula === 'H2O', `water structure missing: ${water.formula}`);
    await page.locator('.identity-panel h1').filter({ hasText: /^물$/ }).waitFor();
    await page.locator('.identity-panel .iupac-name').filter({ hasText: /oxidane/ }).waitFor();
    releaseEthanol(); await page.waitForTimeout(250);
    assert((await page.locator('.identity-panel h1').textContent())?.trim() === '물', 'late ethanol response replaced water title');
    assert((await page.locator('.identity-panel .iupac-name').textContent())?.includes('oxidane'), 'late ethanol response replaced oxidane');
    return { finalTitle: '물', finalIupac: 'oxidane' };
  });

  await runCase(browser, 'unavailable and not-found fall back to formula, then retry succeeds', async (page) => {
    let ccnAttempt = 0;
    await page.route('**/api/molecule?lookup=name', async (route) => {
      const { smiles } = route.request().postDataJSON();
      if (smiles !== 'CCN') { await fulfill(route, available(smiles, { commonName: '에탄올', iupacName: 'ethanol', cid: 702 })); return; }
      ccnAttempt += 1;
      if (ccnAttempt === 1) await fulfill(route, unavailable('CCN', 'unavailable'));
      else {
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (ccnAttempt === 2) await fulfill(route, unavailable('CCN', 'not_found'));
        else await fulfill(route, available('CCN', { iupacName: 'ethanamine', cid: 6341 }));
      }
    });
    await openApp(page); const ethylamine = await submitStructure(page, 'CCN');
    const formula = ethylamine.formula;
    await page.locator('.identity-panel').getByText('이름 확인 불가', { exact: true }).waitFor();
    assert((await page.locator('.identity-panel h1').textContent())?.trim() === formula, 'unavailable did not use formula title');
    await retryNaming(page);
    await page.locator('.identity-panel').getByText('이름 확인 불가', { exact: true }).waitFor();
    assert((await page.locator('.identity-panel h1').textContent())?.trim() === formula, 'not_found did not use formula title');
    await retryNaming(page);
    await page.locator('.identity-panel h1').filter({ hasText: /^ethanamine$/ }).waitFor();
    assert((await page.locator('.identity-panel > .eyebrow').textContent())?.trim() === 'IUPAC NAME', 'IUPAC-only title is not identified');
    return { unavailableTitle: formula, notFoundTitle: formula, retryTitle: 'ethanamine', attempts: ccnAttempt };
  });

  await runCase(browser, 'available name persists through storage, load, card DOM and PNG', async (page) => {
    await page.route('**/api/molecule?lookup=name', (route) => fulfill(route, available('CCO', { commonName: '에탄올', iupacName: 'ethanol', cid: 702 })));
    await openApp(page);
    await page.locator('.identity-panel .iupac-name').filter({ hasText: /ethanol/ }).waitFor();
    await page.getByRole('textbox', { name: '학습 노트' }).fill('이름 저장 검증 노트');
    const distance = await recordDistance(page);
    await page.getByRole('button', { name: '현재 분자를 컬렉션에 저장', exact: true }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('molecule-studio.collection.v1') || '[]')[0]);
    assert(stored.notes === '이름 저장 검증 노트', 'stored note differs');
    assert(stored.measurements?.length === 1 && stored.measurements[0].label === distance, 'stored measurement differs');
    assert(JSON.stringify(stored.molecule.naming) === JSON.stringify(available('CCO', { commonName: '에탄올', iupacName: 'ethanol', cid: 702 })), 'stored naming metadata differs');
    await page.locator('.collection-load').first().click();
    assert(await page.getByRole('textbox', { name: '학습 노트' }).inputValue() === '이름 저장 검증 노트', 'loaded note differs');
    assert((await page.locator('.saved-measurements').textContent())?.includes(distance), 'loaded measurement differs');
    assert((await page.locator('.study-card h1').textContent())?.trim() === '에탄올', 'card title differs');
    assert((await page.locator('.study-card .iupac-name').textContent())?.includes('ethanol'), 'card IUPAC name missing');
    assert((await page.locator('.study-card .naming-source').textContent())?.includes('PubChem CID 702'), 'card source missing');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '학습 카드', exact: true }).click();
    const download = await downloadPromise;
    const target = path.join(evidenceDir, 'named-ethanol-study-card.png'); await download.saveAs(target);
    assert((await stat(target)).size > 1000, 'named study card PNG is empty');
    return { storageExact: true, title: '에탄올', iupac: 'ethanol', source: 'PubChem CID 702', png: target };
  });

  await runCase(browser, 'legacy full molecule fixture keeps notes and measurements while naming upgrades', async (page) => {
    let namingRequests = 0;
    let holdReloadDefault = false;
    let releaseReloadDefault;
    const reloadDefaultGate = new Promise((resolve) => { releaseReloadDefault = resolve; });
    await page.route('**/api/molecule?lookup=name', async (route) => {
      namingRequests += 1;
      if (holdReloadDefault && namingRequests === 2) { await reloadDefaultGate; await fulfill(route, available('CCO', { commonName: '에탄올', iupacName: 'ethanol', cid: 702 })).catch(() => {}); return; }
      await fulfill(route, available('CCO', { commonName: '에탄올', iupacName: 'ethanol', cid: 702 }));
    });
    const realMolecule = await openApp(page);
    const legacyMeasurement = { kind: 'distance', atoms: [0, 1], value: 1.23, label: 'legacy 0–1: 1.23 Å' };
    await page.evaluate(({ molecule, measurement }) => {
      delete molecule.naming;
      localStorage.setItem('molecule-studio.collection.v1', JSON.stringify([{ id: 'legacy-full', savedAt: '2026-09-15T00:00:00.000Z', molecule, notes: 'legacy full note', measurements: [measurement] }]));
    }, { molecule: structuredClone(realMolecule), measurement: legacyMeasurement });
    holdReloadDefault = true;
    const reloadResponse = page.waitForResponse((response) => response.url().endsWith('/api/molecule') && response.request().method() === 'POST');
    const heldNameRequest = page.waitForRequest((request) => request.url().includes('/api/molecule?lookup=name'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitForStructure(page, await reloadResponse);
    await heldNameRequest;
    await page.getByRole('button', { name: /내 컬렉션/ }).click(); await page.locator('.collection-load').first().click();
    await page.locator('.identity-panel .iupac-name').filter({ hasText: /ethanol/ }).waitFor();
    releaseReloadDefault();
    assert(await page.getByRole('textbox', { name: '학습 노트' }).inputValue() === 'legacy full note', 'legacy note changed during naming lookup');
    assert((await page.locator('.saved-measurements').textContent())?.includes(legacyMeasurement.label), 'legacy measurement changed during naming lookup');
    const upgraded = await page.evaluate(() => JSON.parse(localStorage.getItem('molecule-studio.collection.v1') || '[]')[0]);
    assert(upgraded.molecule.naming?.iupacName === 'ethanol', 'legacy entry was not upgraded with naming');
    assert(upgraded.notes === 'legacy full note' && upgraded.measurements[0].label === legacyMeasurement.label, 'metadata upgrade altered saved study data');
    assert(namingRequests >= 3, `legacy load did not start its own naming request: ${namingRequests}`);
    return { actualStructureFixture: true, namingRequests, heldDefaultLookup: true, notesPreserved: true, measurementPreserved: true };
  });

  await runCase(browser, 'long IUPAC-only title wraps at 390px', async (page) => {
    const longName = 'N-'.repeat(55) + 'ethanamine';
    await page.route('**/api/molecule?lookup=name', async (route) => {
      const { smiles } = route.request().postDataJSON();
      if (smiles === 'CCN') await fulfill(route, available('CCN', { iupacName: longName, cid: 6341 }));
      else await fulfill(route, available('CCO', { commonName: '에탄올', iupacName: 'ethanol', cid: 702 }));
    });
    await openApp(page); await submitStructure(page, 'CCN');
    await page.locator('.identity-panel h1').filter({ hasText: longName }).waitFor();
    const layout = await page.evaluate(() => {
      const title = document.querySelector('.identity-panel h1');
      const hud = document.querySelector('[aria-label="분자 3차원 구조 뷰어"] strong');
      return { viewport: document.documentElement.clientWidth, body: document.body.scrollWidth, titleClient: title?.clientWidth, titleScroll: title?.scrollWidth, titleWhiteSpace: title ? getComputedStyle(title).whiteSpace : '', titleWrap: title ? getComputedStyle(title).overflowWrap : '', hudClient: hud?.clientWidth, hudScroll: hud?.scrollWidth };
    });
    assert(layout.body <= layout.viewport + 1, `mobile body overflows: ${JSON.stringify(layout)}`);
    assert(layout.titleWhiteSpace !== 'nowrap' && layout.titleWrap === 'anywhere' && layout.titleScroll <= layout.titleClient + 1, `title does not wrap: ${JSON.stringify(layout)}`);
    assert(layout.hudScroll <= layout.hudClient + 1, `viewer HUD overflows: ${JSON.stringify(layout)}`);
    await page.screenshot({ path: path.join(evidenceDir, 'mobile-long-iupac.png'), fullPage: true });
    return layout;
  }, { viewport: { width: 390, height: 844 } });
} finally {
  if (browser) await browser.close();
}

const report = { baseUrl: BASE_URL, browser: `${BROWSER_CHANNEL}/headless`, generatedAt: new Date().toISOString(), namingResponses: 'controlled route mocks; molecular structure API is live', caseFilter, cases, pageErrors, passed: (caseFilter ? cases.length > 0 : cases.length === 6) && cases.every((item) => item.status === 'passed') && pageErrors.length === 0 };
await writeFile(path.join(evidenceDir, 'browser-naming-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
