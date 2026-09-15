import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function scienceBrowserCases({ page, runCase, submitSmiles, setMode, selectAtom, waitForMolecule, verifyPngContent, evidenceDir }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const text = async (locator) => (await locator.textContent())?.trim() ?? '';
  const key = 'molecule-studio.collection.v1';
  const formula = () => text(page.locator('.identity-panel .formula'));
  let co2, water, savedWater;
  const exportPng = async (name) => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '학습 카드', exact: true }).click();
    const download = await pending;
    const target = path.join(evidenceDir, name);
    await download.saveAs(target);
    return verifyPngContent(page, target);
  };

  await runCase('brief: four examples and real WebGL rotation and zoom', async () => {
    const results = [];
    for (const name of ['물', '에탄올', '카페인', '아스피린']) {
      const pending = page.waitForResponse(r => r.url().endsWith('/api/molecule') && r.request().postDataJSON()?.name === name);
      await page.locator('.examples').getByRole('button', { name, exact: true }).click();
      const response = await pending;
      assert(response.ok(), `${name}: API failed`);
      await waitForMolecule(page);
      results.push({ name, formula: await formula() });
    }
    const canvas = page.locator('.viewer-stage canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const shot = () => canvas.evaluate(node => node.toDataURL());
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const initial = await shot();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 35, { steps: 12 });
    await page.mouse.up(); await frames();
    const rotated = await shot();
    assert(rotated !== initial, '3D canvas did not change after rotation');
    await page.mouse.wheel(0, -350); await frames();
    assert(await shot() !== rotated, '3D canvas did not change after zoom');
    return { examples: results, realCanvasRotation: true, zoom: true };
  });

  await runCase('brief: CO2 abstains and acetone uses ranges in screen and PNG', async () => {
    co2 = await (await submitSmiles(page, 'O=C=O')).json();
    await setMode(page, 'inspect'); await selectAtom(page, 1, 'C');
    assert((await text(page.locator('.inspector'))).includes('AX2'), 'CO2 central carbon lost AX2');
    await page.getByRole('tab', { name: '13C NMR', exact: true }).click();
    const screen = await text(page.locator('.spectra'));
    const card = await text(page.locator('.study-card'));
    assert(screen.includes('자료/규칙 미지원') && !screen.includes('212.5') && !card.includes('케톤'), 'CO2 retained the old ketone interpretation');
    assert(await page.locator('.spectra rect[data-region]').count() === 0, 'CO2 invented a carbon range');
    await page.screenshot({ path: path.join(evidenceDir, 'co2-ranges.png'), fullPage: true });
    await submitSmiles(page, 'CC(=O)C');
    await page.getByRole('tab', { name: '13C NMR', exact: true }).click();
    assert((await text(page.locator('.spectra'))).includes('205–220 ppm'), 'acetone ketone range missing');
    assert(!(await text(page.locator('.spectra'))).includes('212.5'), 'midpoint presented as peak');
    const displayed = await page.locator('.spectra .range-list li').allTextContents();
    const cardDisplayed = await page.locator('.study-spectrum').filter({ hasText: '¹³C NMR' }).locator('.range-list li').allTextContents();
    assert(JSON.stringify(displayed) === JSON.stringify(cardDisplayed), 'screen and card range values disagree');
    const heights = await page.locator('.spectra rect[data-region]').evaluateAll(nodes => nodes.map(n => n.getAttribute('height')));
    assert(heights.length > 0 && new Set(heights).size === 1, 'ranges imply relative intensities');
    const png = await exportPng('acetone-reference-card.png');
    await page.screenshot({ path: path.join(evidenceDir, 'acetone-ranges.png'), fullPage: true });
    return { co2Status: 'unsupported', acetone: displayed, screenAndCardEqual: true, png };
  });

  await runCase('brief: water descriptors and coordinate-derived measurements survive reload', async () => {
    water = await (await submitSmiles(page, 'O')).json();
    assert(water.properties.hbd === 0 && water.properties.hba === 0, 'raw water descriptor was overwritten');
    assert((await text(page.locator('.identity-panel'))).includes('주개와 받개 역할을 모두'), 'water role missing');
    await page.locator('.hydrogen-bond-notes details summary').click();
    assert((await text(page.locator('.identity-panel'))).includes('CalcNumHBA'), 'descriptor definition missing');
    await setMode(page, 'distance'); await selectAtom(page, 0, 'O'); await selectAtom(page, 1, 'H');
    const actualDistance = Math.hypot(...['x', 'y', 'z'].map(k => water.atoms[0][k] - water.atoms[1][k]));
    const distanceText = await text(page.locator('.measurement-strip b'));
    assert(Math.abs(Number(distanceText.match(/([\d.]+)\s*Å/)[1]) - actualDistance) <= .0051, 'distance does not match model coordinates');
    await page.locator('.measurement-strip').getByRole('button', { name: '기록', exact: true }).click();
    await setMode(page, 'angle'); await selectAtom(page, 1, 'H'); await selectAtom(page, 0, 'O'); await selectAtom(page, 2, 'H');
    const u = ['x', 'y', 'z'].map(k => water.atoms[1][k] - water.atoms[0][k]);
    const v = ['x', 'y', 'z'].map(k => water.atoms[2][k] - water.atoms[0][k]);
    const actualAngle = Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, n, i) => sum + n * v[i], 0) / (Math.hypot(...u) * Math.hypot(...v))))) * 180 / Math.PI;
    const angleText = await text(page.locator('.measurement-strip b'));
    assert(Math.abs(Number(angleText.match(/([\d.]+)°/)[1]) - actualAngle) <= .051, 'angle does not match current coordinates');
    assert((await text(page.locator('.measurement-strip'))).includes('두 번째'), 'angle vertex instructions missing');
    await page.locator('.measurement-strip').getByRole('button', { name: '기록', exact: true }).click();
    await setMode(page, 'inspect'); await selectAtom(page, 0, 'O');
    const geometry = await text(page.locator('.inspector'));
    assert(geometry.includes('109.5°') && geometry.includes('104.4776°') && geometry.includes('기체상'), 'geometry meanings not separated');
    await page.getByRole('tab', { name: '13C NMR', exact: true }).click();
    assert((await text(page.locator('.spectra'))).includes('해당 원자 없음'), 'water missing-carbon state is ambiguous');
    await page.getByRole('textbox', { name: '학습 노트' }).fill('모델 좌표 측정과 기체상 평형 참고값 비교');
    await page.getByRole('button', { name: '현재 분자를 컬렉션에 저장' }).click();
    savedWater = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0], key);
    assert(savedWater.measurements.length === 2, 'measurements not saved');
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitForMolecule(page);
    await page.locator('.collection-button').click(); await page.locator('.collection-load').first().click();
    const loaded = await page.getByRole('textbox', { name: '학습 노트' }).inputValue();
    assert(loaded === savedWater.notes, 'note lost after reload');
    assert((await text(page.locator('.saved-measurements'))).includes(angleText), 'saved angle lost');
    const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0], key);
    assert(JSON.stringify(stored) === JSON.stringify(savedWater), 'collection data mutated on load');
    await setMode(page, 'inspect'); await selectAtom(page, 0, 'O');
    const png = await exportPng('water-model-reference-card.png');
    return { actualDistance, distanceText, actualAngle, angleText, savedMeasurements: 2, reloadPreserved: true, png };
  });

  await runCase('brief: same structure reanalysis keeps notes and clears old measurements', async () => {
    // A custom saved name must not turn the same chemical structure into a different molecule.
    const named = { ...savedWater, id: 'named-water-check', molecule: { ...savedWater.molecule, name: '이름을 붙인 물' } };
    await page.evaluate(({ key, named }) => localStorage.setItem(key, JSON.stringify([named])), { key, named });
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitForMolecule(page);
    await page.locator('.collection-button').click(); await page.locator('.collection-load').first().click();
    await submitSmiles(page, 'O');
    assert(await page.getByRole('textbox', { name: '학습 노트' }).inputValue() === named.notes, 'same-structure note lost after name changed');
    assert(await page.locator('.saved-measurements span').count() === 0, 'old coordinates still have saved measurements after reanalysis');
    await submitSmiles(page, 'CCO'); await setMode(page, 'inspect'); await selectAtom(page, 2, 'O');
    assert(!(await text(page.locator('.inspector'))).includes('104.4776'), 'water reference leaked to ethanol');
    assert(await page.getByRole('textbox', { name: '학습 노트' }).inputValue() === '', 'different molecule inherited notes');
    await submitSmiles(page, 'CC(=O)N'); await setMode(page, 'inspect'); await selectAtom(page, 3, 'N');
    assert((await text(page.locator('.inspector'))).includes('판정 보류'), 'amide nitrogen forced into VSEPR');
    assert((await text(page.locator('.study-card'))).includes('공명 환경'), 'amide abstention explanation missing from card');
    return { sameStructureNotes: true, reanalysisMeasurementsCleared: true, ethanolReferenceAbsent: true, amideAbstention: true };
  });

  await runCase('brief: invalid valence keeps clearly marked previous result', async () => {
    const before = await formula();
    await page.locator('#smiles').fill('C(C)(C)(C)(C)C');
    const pending = page.waitForResponse(r => r.url().endsWith('/api/molecule') && r.request().postDataJSON()?.smiles === 'C(C)(C)(C)(C)C');
    await page.getByRole('button', { name: 'SMILES 분석', exact: true }).click();
    assert((await pending).status() === 400, 'invalid valence accepted');
    await page.locator('.error-banner').waitFor();
    const error = await text(page.locator('.error-banner'));
    assert(error.includes('이전 분석 결과') && error.includes('원자가'), 'error is not actionable or result provenance missing');
    assert(await formula() === before, 'failure corrupted previous model');
    await submitSmiles(page, 'O');
    assert(await page.locator('.error-banner').count() === 0, 'error remained after success');
    return { error, priorFormula: before };
  });

  await runCase('brief: legacy collection hides old chemistry without changing saved coordinates', async () => {
    const legacy = { id: 'legacy-co2-fixture', savedAt: new Date().toISOString(), notes: '구형 CO2 설명 마스킹 검사', measurements: [], molecule: { ...co2 } };
    delete legacy.molecule.analysisVersion;
    legacy.molecule.spectra = [{ kind: '13C NMR', title: 'Old carbon peaks', unit: 'ppm', xMin: 0, xMax: 230, peaks: [{ position: 212.5, intensity: .65, label: 'ketone carbonyl C', range: [205, 220] }], notice: 'old', supported: true }];
    await page.evaluate(({ key, legacy, savedWater }) => localStorage.setItem(key, JSON.stringify([legacy, savedWater])), { key, legacy, savedWater });
    await page.reload({ waitUntil: 'domcontentloaded' }); await waitForMolecule(page);
    await page.locator('.collection-button').click(); await page.locator('.collection-load').first().click();
    assert(await formula() === 'CO2', 'legacy model not loaded');
    const content = await text(page.locator('main'));
    assert(!content.includes('212.5') && !content.includes('ketone'), 'legacy misclassification reappeared');
    assert(content.includes('이전 버전으로 저장된 자료'), 'legacy interpretation is not identified');
    assert(JSON.stringify(await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0], key)) === JSON.stringify(legacy), 'loading changed original legacy data');
    return { syntheticLegacyFixture: true, originalDataPreserved: true, oldScienceHidden: true };
  });

  await runCase('brief: pending response cannot overwrite loaded collection', async () => {
    let release, started, finished;
    const held = new Promise(resolve => { release = resolve; });
    const seen = new Promise(resolve => { started = resolve; });
    const done = new Promise(resolve => { finished = resolve; });
    await page.route('**/api/molecule', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      started(); await held;
      await route.fulfill({ status: 200, json: co2 }).catch(() => {}); finished();
    });
    try {
      await page.locator('#smiles').fill('O=C=O');
      await page.getByRole('button', { name: 'SMILES 분석', exact: true }).click(); await seen;
      await page.locator('.collection-button').click();
      await page.locator('.collection-load').filter({ hasText: 'H2O' }).first().click();
      release(); await done;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(await formula() === 'H2O', 'late response replaced loaded water');
      assert(await page.getByRole('textbox', { name: '학습 노트' }).inputValue() === savedWater.notes, 'late response replaced saved note');
    } finally { release(); await page.unroute('**/api/molecule'); }
    return { controlledDelayedResponse: true, collectionWon: true };
  });

  await runCase('brief: benzene editor and MOL file round trip', async () => {
    const sketch = page.locator('section.sketcher');
    await sketch.getByRole('button', { name: '모두 지우기' }).click();
    await sketch.getByRole('button', { name: '벤젠 고리 추가' }).click();
    let pending = page.waitForResponse(r => r.url().endsWith('/api/molecule') && !!r.request().postDataJSON()?.graph);
    await sketch.getByRole('button', { name: '3D 만들기' }).click();
    const benzene = await (await pending).json(); await waitForMolecule(page);
    assert(benzene.formula === 'C6H6' && benzene.smiles === 'c1ccccc1', 'benzene graph changed');
    const file = path.join(evidenceDir, 'benzene.mol');
    await writeFile(file, benzene.molblock, 'utf8');
    pending = page.waitForResponse(r => r.url().endsWith('/api/molecule') && !!r.request().postDataJSON()?.molblock);
    await page.locator('input[type=file]').setInputFiles({ name: 'benzene.mol', mimeType: 'chemical/x-mdl-molfile', buffer: await readFile(file) });
    const after = await (await pending).json(); await waitForMolecule(page);
    assert(after.smiles === benzene.smiles && after.formula === benzene.formula, 'MOL import changed chemistry');
    return { formula: after.formula, smiles: after.smiles, fixture: file };
  });
}
