import { Download, FileUp, FlaskConical, FolderHeart, HelpCircle, LoaderCircle, Plus, RotateCcw, Ruler, ScanSearch, Sparkles, Trash2, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import MoleculeViewer from './components/MoleculeViewer';
import Sketcher from './components/Sketcher';
import Spectra from './components/Spectra';
import SpectrumRanges from './components/SpectrumRanges';
import { GeometryNotes, HydrogenBondNotes } from './components/ScienceNotes';
import { legacyNotice, savedMoleculeForDisplay } from './lib/education';
import type { Measurement, Molecule, MoleculeRequest, Spectrum, Vsepr } from './types';
import { calculateMeasurement, examples, graphFromMolecule, moleculeDisplayName, selectedVsepr, type EditorGraph } from './lib/chemistry';

type Mode = 'inspect' | 'distance' | 'angle';
type SavedEntry = { id: string; savedAt: string; molecule: Molecule; notes: string; measurements: Measurement[] };
const storageKey = 'molecule-studio.collection.v1';
const blankGraph: EditorGraph = { atoms: [], bonds: [] };
const vseprKorean: Record<string, string> = {
  linear: '직선형', 'trigonal planar': '평면 삼각형', bent: '굽은형', tetrahedral: '정사면체형',
  'trigonal pyramidal': '삼각뿔형', 'trigonal bipyramidal': '삼각쌍뿔형', seesaw: '시소형',
  'T-shaped': 'T자형', octahedral: '팔면체형', 'square pyramidal': '사각뿔형', 'square planar': '평면 사각형',
  'not assigned': '판정하지 않음',
};
function koreanVsepr(value: string): string { return vseprKorean[value] ?? value; }

function readCollection(): { entries: SavedEntry[]; problem: string } {
  try {
    const value = localStorage.getItem(storageKey);
    if (!value) return { entries: [], problem: '' };
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('invalid collection');
    return { entries: parsed.filter((entry): entry is SavedEntry => Boolean(entry && typeof entry === 'object' && 'molecule' in entry)), problem: '' };
  } catch {
    return { entries: [], problem: '로컬 컬렉션을 읽지 못했습니다. 브라우저 저장 공간을 확인해 주세요.' };
  }
}
function saveCollection(entries: SavedEntry[]): string {
  try { localStorage.setItem(storageKey, JSON.stringify(entries.slice(0, 30))); return ''; }
  catch { return '컬렉션을 저장하지 못했습니다. 브라우저 저장 공간을 비운 뒤 다시 시도해 주세요.'; }
}
function download(data: string, filename: string) { const anchor = document.createElement('a'); anchor.href = data; anchor.download = filename; anchor.click(); }
function responseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const error = 'error' in body ? body.error : null;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' && /[가-힣]/.test(error.message)) return error.message;
  if (typeof error === 'string' && /[가-힣]/.test(error)) return error;
  if ('detail' in body && typeof body.detail === 'string' && /[가-힣]/.test(body.detail)) return body.detail;
  return fallback;
}

function CardSpectrum({ spectrum }: { spectrum: Spectrum }) {
  return <section className="study-spectrum"><SpectrumRanges spectrum={spectrum} /></section>;
}

function VseprDiagram({ vsepr }: { vsepr: Vsepr }) {
  if (!vsepr.supported) return null;
  // Schematic projections: positive depth is a wedge; negative depth is dashed.
  const positions: Record<string, [number, number, number][]> = {
    linear: [[14, 50, 0], [86, 50, 0]],
    bent: [[22, 72, 0], [78, 72, 0]],
    'trigonal planar': [[50, 14, 0], [19, 68, 0], [81, 68, 0]],
    tetrahedral: [[50, 14, 0], [16, 64, 0], [54, 86, 1], [84, 68, -1]],
    'trigonal pyramidal': [[16, 64, 0], [54, 86, 1], [84, 68, -1]],
    'trigonal bipyramidal': [[50, 10, 0], [50, 90, 0], [14, 50, 0], [78, 72, 1], [78, 28, -1]],
    seesaw: [[50, 10, 0], [50, 90, 0], [78, 72, 1], [78, 28, -1]],
    'T-shaped': [[50, 14, 0], [50, 86, 0], [86, 50, 0]],
    octahedral: [[50, 10, 0], [50, 90, 0], [14, 50, 0], [86, 50, 0], [25, 75, 1], [75, 25, -1]],
    'square pyramidal': [[50, 10, 0], [14, 50, 0], [86, 50, 0], [25, 75, 1], [75, 25, -1]],
    'square planar': [[50, 14, 0], [50, 86, 0], [14, 50, 0], [86, 50, 0]],
  };
  const ligands = positions[vsepr.shape];
  if (!ligands) return null;
  const lonePairs = Math.max(0, vsepr.lonePairs ?? 0);
  return <div className="vsepr-diagram"><div><svg viewBox="0 0 100 100" role="img" aria-label={`${vsepr.notation} 이상 VSEPR 구조도`}>
    {ligands.map(([x, y, depth], index) => {
      const length = Math.hypot(x - 50, y - 50);
      const dx = -(y - 50) / length * 4, dy = (x - 50) / length * 4;
      return <g key={index}>{depth > 0
        ? <polygon points={`50,50 ${x + dx},${y + dy} ${x - dx},${y - dy}`} fill="#6a9792" />
        : <line x1="50" y1="50" x2={x} y2={y} strokeDasharray={depth < 0 ? '3 3' : undefined} />}
        <circle cx={x} cy={y} r="7" /></g>;
    })}
    <circle className="center" cx="50" cy="50" r="10" /><text x="50" y="54" textAnchor="middle">A</text>
  </svg></div><p><b>{vsepr.notation}</b> · {koreanVsepr(vsepr.shape)}<small>VSEPR 평면 투영 · 비공유 전자쌍 {lonePairs}개</small><small>쐐기: 앞 · 점선: 뒤 · 그림의 각도는 측정값 아님</small></p></div>;
}

function StudyCard({ molecule, notes, measurements, vsepr, image, cardRef }: { molecule: Molecule; notes: string; measurements: Measurement[]; vsepr: ReturnType<typeof selectedVsepr>; image: string; cardRef: RefObject<HTMLElement | null> }) {
  const structureSvg = molecule.svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(molecule.svg)}` : '';
  return <article ref={cardRef} className="study-card" aria-hidden="true">
    <header><div className="study-mark">MS</div><div><small>MOLECULE STUDIO · STUDY CARD</small><h1>{moleculeDisplayName(molecule.name)}</h1><p>{molecule.formula} · {molecule.molWeight.toFixed(2)} g/mol</p></div></header>
    <div className="study-main"><div className="study-visual"><h3>3D 구조</h3>{image ? <img src={image} alt="3D 분자 구조" /> : <div className="study-placeholder">3D molecular view</div>}</div><div className="study-visual two-d"><h3>2D 구조</h3>{structureSvg ? <img src={structureSvg} alt="2D 분자 구조" /> : <div className="study-placeholder">2D structure</div>}</div><div className="study-data"><h3>구조 표기</h3><code>{molecule.smiles}</code><h3>VSEPR</h3><p>{vsepr ? `${vsepr.supported ? vsepr.notation : '판정 보류'} · ${koreanVsepr(vsepr.shape)}` : '선택 원자 없음'}</p>{vsepr && <p>{vsepr.explanation}</p>}<GeometryNotes molecule={molecule} vsepr={vsepr} /><h3>현재 모델 좌표의 측정</h3>{measurements.length ? measurements.map((item) => <p key={`${item.kind}-${item.atoms.join('-')}`}>{item.label}</p>) : <p>저장된 측정값 없음</p>}</div></div>
    <section className="study-spectra"><div className="study-section-heading"><h3>분광 참고 범위</h3><p>구조 규칙의 참고 구간 · 실제 피크 위치·강도·적분을 계산하지 않습니다.</p></div>{molecule.spectra.length ? <div className="study-spectrum-grid">{molecule.spectra.slice(0, 4).map((spectrum, index) => <CardSpectrum key={`${spectrum.kind}-${index}`} spectrum={spectrum} />)}</div> : <p className="study-empty">참고 범위 미제공</p>}</section>
    <HydrogenBondNotes molecule={molecule} compact /><div className="study-bottom"><div><h3>학습 노트</h3><p>{notes || '핵심 관찰을 여기에 기록하세요.'}</p></div><div><h3>계산 방법과 한계</h3><p>모델 생성: {molecule.method}. 거리·각도는 현재 좌표의 계산값입니다. 각도 측정에서 두 번째 원자가 꼭짓점입니다. 오비탈 표시는 혼성화 기반 개념도이며 양자화학 오비탈 계산 결과가 아닙니다.</p>{molecule.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>
  </article>;
}

export default function App() {
  const [{ entries: initialCollection, problem: initialStorageProblem }] = useState(readCollection);
  const [molecule, setMolecule] = useState<Molecule | null>(null);
  const [graph, setGraph] = useState<EditorGraph>(blankGraph);
  const [smiles, setSmiles] = useState('CCO');
  const [mode, setMode] = useState<Mode>('inspect');
  const [selectedAtoms, setSelectedAtoms] = useState<number[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [notes, setNotes] = useState('');
  const [showHydrogens, setShowHydrogens] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showOrbitals, setShowOrbitals] = useState(false);
  const [showAllAtomPicker, setShowAllAtomPicker] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [collection, setCollection] = useState<SavedEntry[]>(initialCollection);
  const [storageProblem, setStorageProblem] = useState(initialStorageProblem);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [viewerCapture, setViewerCapture] = useState<(() => string) | null>(null);
  const [captureImage, setCaptureImage] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const moleculeKeyRef = useRef('');
  const cardRef = useRef<HTMLElement | null>(null);

  const request = useCallback(async (payload: MoleculeRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    const requestSequence = ++requestSequenceRef.current;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    setLoading(true); setError(''); setAnalysisFailed(false);
    try {
      const response = await fetch('/api/molecule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(responseError(body, '분자 정보를 읽지 못했습니다. 표기를 확인해 주세요.'));
      const next = (body?.molecule ?? body) as Molecule;
      if (!next?.atoms || !next?.bonds) throw new Error('분자 데이터 형식이 올바르지 않습니다.');
      if (controller.signal.aborted || requestSequence !== requestSequenceRef.current) return;
      const nextKey = next.smiles;
      const changedMolecule = moleculeKeyRef.current !== nextKey;
      moleculeKeyRef.current = nextKey;
      setMolecule(next); setSmiles(next.smiles || payload.smiles || ''); setGraph(graphFromMolecule(next)); setSelectedAtoms([]); setMeasurements([]); if (changedMolecule) setNotes(''); setCaptureImage(''); setResetKey((value) => value + 1);
    } catch (caught) {
      if (requestSequence !== requestSequenceRef.current) return;
      if (timedOut || (caught as Error).name !== 'AbortError') setAnalysisFailed(true);
      if (timedOut) setError('분자 계산이 60초 안에 끝나지 않았습니다. 구조를 단순하게 하거나 다시 시도해 주세요.');
      else if ((caught as Error).name !== 'AbortError') setError(/[가-힣]/.test((caught as Error).message) ? (caught as Error).message : '서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 분석해 주세요.');
    } finally {
      window.clearTimeout(timeoutId);
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => { request({ smiles: 'CCO', name: '에탄올' }); return () => abortRef.current?.abort(); }, [request]);

  const currentMeasurement = useMemo(() => molecule ? calculateMeasurement(molecule.atoms, selectedAtoms, mode === 'angle' ? 'angle' : 'distance') : null, [molecule, mode, selectedAtoms]);
  const vseprAtomIds = mode === 'angle' && selectedAtoms.length > 1 ? [selectedAtoms[1]] : selectedAtoms;
  const vsepr = selectedVsepr(molecule, vseprAtomIds);
  const pickerAtoms = useMemo(() => molecule?.atoms.filter((atom) => (showHydrogens && showAllAtomPicker) || atom.element !== 'H') ?? [], [molecule, showAllAtomPicker, showHydrogens]);
  const chooseMode = (next: Mode) => { setMode(next); setSelectedAtoms([]); };
  const atomClick = useCallback((id: number) => {
    const maximum = mode === 'angle' ? 3 : mode === 'distance' ? 2 : 1;
    setSelectedAtoms((old) => {
      if (old.includes(id)) return old.filter((value) => value !== id);
      if (maximum === 1) return [id];
      return [...old.slice(-(maximum - 1)), id];
    });
  }, [mode]);
  const saveEntry = () => {
    if (!molecule) return;
    const entry: SavedEntry = { id: crypto.randomUUID?.() ?? `${Date.now()}`, savedAt: new Date().toISOString(), molecule, notes, measurements };
    const next = [entry, ...collection];
    const problem = saveCollection(next);
    if (problem) { setStorageProblem(problem); setError(problem); return; }
    setStorageProblem(''); setCollection(next); setCollectionOpen(true);
  };
  const loadEntry = (entry: SavedEntry) => {
    abortRef.current?.abort(); requestSequenceRef.current += 1;
    moleculeKeyRef.current = entry.molecule.smiles;
    setMolecule(savedMoleculeForDisplay(entry.molecule)); setGraph(graphFromMolecule(entry.molecule));
    setSmiles(entry.molecule.smiles); setNotes(entry.notes); setMeasurements(entry.measurements);
    setSelectedAtoms([]); setCollectionOpen(false); setLoading(false); setError(''); setAnalysisFailed(false);
    setCaptureImage(''); setResetKey((value) => value + 1);
  };
  const removeEntry = (id: string) => { const next = collection.filter((entry) => entry.id !== id); const problem = saveCollection(next); if (problem) { setStorageProblem(problem); setError(problem); return; } setStorageProblem(''); setCollection(next); };
  const importMol = async (file?: File) => { if (!file) return; try { await request({ molblock: await file.text(), name: file.name.replace(/\.[^.]+$/, '') }); } catch { /* request owns display */ } };
  const exportCard = async () => {
    if (!molecule || !cardRef.current) return;
    setExporting(true);
    try {
      const captured = viewerCapture?.() || '';
      setCaptureImage(captured);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(Array.from(cardRef.current.querySelectorAll('img')).map((image) => image.decode().catch(() => undefined)));
      // Static positioning also neutralizes computed logical inset properties.
      const png = await toPng(cardRef.current, { width: cardRef.current.scrollWidth, height: cardRef.current.scrollHeight, pixelRatio: 2, backgroundColor: '#fbfaf5', cacheBust: true, style: { position: 'static', margin: '0' } });
      download(png, `${(molecule.name || 'molecule').replace(/[^a-z0-9가-힣_-]/gi, '_')}_study-card.png`);
    } catch { setError('학습 카드를 이미지로 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    finally { setExporting(false); }
  };

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="분자 스튜디오 홈"><span className="brand-orbit"><i /><i /><i /></span><span>Molecule <b>Studio</b><small>분자 스튜디오</small></span></a><div className="top-actions"><button className="help-button" onClick={() => document.getElementById('quick-help')?.scrollIntoView({ behavior: 'smooth' })}><HelpCircle size={17} /> 사용법</button><button className="collection-button" onClick={() => setCollectionOpen(true)}><FolderHeart size={17} /> 내 컬렉션 <span>{collection.length}</span></button><button className="primary" onClick={exportCard} disabled={!molecule || exporting}>{exporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} 학습 카드</button></div></header>
    <div className="workspace" id="top">
      <aside className="left-column"><section className="panel smiles-panel"><div className="panel-title"><div><span className="eyebrow">START HERE</span><h2>SMILES로 시작</h2></div><FlaskConical size={20} /></div><label className="sr-only" htmlFor="smiles">SMILES 구조 표기</label><div className="smiles-input"><input id="smiles" value={smiles} onChange={(event) => setSmiles(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && request({ smiles })} placeholder="예: CCO" /><button onClick={() => request({ smiles })} disabled={!smiles.trim() || loading} aria-label="SMILES 분석"><ScanSearch size={18} /></button></div><div className="examples">{examples.map((example) => <button key={example.smiles} onClick={() => { setSmiles(example.smiles); request({ smiles: example.smiles, name: example.name }); }}>{example.label}</button>)}</div><label className="file-import"><FileUp size={16} /> MOL 파일 가져오기<input type="file" accept=".mol,.sdf,text/plain" onChange={(event) => importMol(event.target.files?.[0])} /></label></section>
        <Sketcher graph={graph} onChange={setGraph} onConvert={() => request({ graph })} disabled={loading} />
      </aside>
      <section className="viewer-column"><div className="viewer-toolbar"><div className="mode-switch" aria-label="원자 선택 모드"><button className={mode === 'inspect' ? 'selected' : ''} onClick={() => chooseMode('inspect')}><ScanSearch size={15} /> 원자 보기</button><button className={mode === 'distance' ? 'selected' : ''} onClick={() => chooseMode('distance')}><Ruler size={15} /> 거리</button><button className={mode === 'angle' ? 'selected' : ''} onClick={() => chooseMode('angle')}>∠ 각도</button></div><div className="viewer-options"><label title="원자 식별 ID와 원소 기호 표시"><input type="checkbox" checked={showLabels} onChange={(event) => setShowLabels(event.target.checked)} /> 원자 라벨</label><label><input type="checkbox" checked={showHydrogens} onChange={(event) => setShowHydrogens(event.target.checked)} /> H 표시</label><label><input type="checkbox" checked={showOrbitals} onChange={(event) => setShowOrbitals(event.target.checked)} /> 오비탈</label><button onClick={() => setResetKey((value) => value + 1)} aria-label="3D 시점 초기화"><RotateCcw size={16} /></button></div></div>
        <div className="viewer-stage">{loading && <div className="viewer-loading"><LoaderCircle className="spin" size={25} /> 구조를 계산하고 있습니다</div>}<MoleculeViewer molecule={molecule} mode={mode} selectedAtoms={selectedAtoms} onAtomClick={atomClick} showHydrogens={showHydrogens} showLabels={showLabels} showOrbitals={showOrbitals} resetKey={resetKey} onCaptureReady={(capture) => setViewerCapture(() => capture)} />{!molecule && !loading && <div className="viewer-empty"><Sparkles size={24} /><p>SMILES를 입력하거나 구조를 그려보세요.</p></div>}</div>
        {error && <div className="error-banner" role="alert"><span>{analysisFailed && molecule && <strong>입력 분석 실패 — 아래는 이전 분석 결과입니다. </strong>}{error}</span><button onClick={() => setError('')} aria-label="오류 닫기"><X size={16} /></button></div>}
        <section className="measurement-strip"><div><span className="eyebrow">현재 모델 좌표에서 계산</span><strong>{mode === 'inspect' ? '원자를 클릭해 구조를 살펴보세요' : mode === 'distance' ? '원자 2개를 선택하세요' : '원자 3개 선택 · 두 번째 원자가 각의 꼭짓점'}</strong></div>{currentMeasurement ? <><b>{currentMeasurement.label}</b><button onClick={() => setMeasurements((items) => items.some((item) => item.label === currentMeasurement.label) ? items : [...items, currentMeasurement])}><Plus size={15} /> 기록</button></> : <span className="muted">선택 {selectedAtoms.length}/{mode === 'angle' ? 3 : mode === 'distance' ? 2 : 1}</span>}</section>
        <Spectra spectra={molecule?.spectra ?? []} />
      </section>
      <aside className="right-column"><section className="panel identity-panel"><span className="eyebrow">MOLECULE</span>{molecule ? <><h1>{moleculeDisplayName(molecule.name)}</h1><p className="formula">{molecule.formula}</p><div className="property-grid"><span>분자량 <b>{molecule.molWeight.toFixed(2)}</b></span><span>원자 수 <b>{molecule.atoms.length}</b></span></div><HydrogenBondNotes molecule={molecule} /><label className="smiles-readonly">SMILES<code>{molecule.smiles}</code></label>{molecule.warnings?.length ? <p className="warning">{molecule.warnings[0]}</p> : null}</> : <p>분석 결과가 여기에 표시됩니다.</p>}</section>
        <section className="panel inspector"><div className="panel-title"><div><span className="eyebrow">INSPECT</span><h2>원자와 형태</h2></div></div>{vsepr ? <div className="vsepr"><div className="vsepr-symbol">{vsepr.supported ? vsepr.notation : "판정 보류"}</div><div><strong>{koreanVsepr(vsepr.shape)}</strong><p>전자영역 배치: {koreanVsepr(vsepr.electronGeometry)}</p></div><p>{vsepr.explanation}</p><VseprDiagram vsepr={vsepr} /><GeometryNotes molecule={molecule!} vsepr={vsepr} /></div> : <p className="muted">{molecule && molecule.analysisVersion !== 2 ? legacyNotice : "3D 모델에서 원자를 클릭하면 VSEPR 형태와 전자쌍 정보를 보여줍니다."}</p>}{molecule ? <div className="atom-picker"><div className="atom-picker-head"><strong>원자 선택</strong><button onClick={() => setShowAllAtomPicker((value) => !value)} disabled={!showHydrogens || !molecule.atoms.some((atom) => atom.element === 'H')}>{showHydrogens && showAllAtomPicker ? '무거운 원자' : '전체 원자'}</button></div><p>버튼으로 원자를 선택할 수 있습니다.</p><div className="atom-picker-list" aria-label="원자 선택 목록">{pickerAtoms.map((atom) => <button key={atom.id} className={selectedAtoms.includes(atom.id) ? 'selected' : ''} onClick={() => atomClick(atom.id)} aria-label={`${atom.id}번 ${atom.element} 원자 선택`}><b>{atom.id}</b><span>{atom.element}</span></button>)}</div>{!showHydrogens && molecule.atoms.some((atom) => atom.element === 'H') ? <small>수소 표시는 3D 옵션에서 켜면 목록에도 추가됩니다.</small> : null}</div> : null}</section>
        <section className="panel notes"><div className="panel-title"><div><span className="eyebrow">NOTEBOOK</span><h2>학습 노트</h2></div><button className="icon-button" onClick={saveEntry} disabled={!molecule} aria-label="컬렉션에 저장"><FolderHeart size={17} /></button></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="관찰한 점, 결합각, 스펙트럼의 근거를 메모하세요…" aria-label="학습 노트" />{measurements.length ? <div className="saved-measurements">{measurements.map((item) => <span key={`${item.kind}-${item.atoms.join('-')}`}>{item.label}<button onClick={() => setMeasurements((items) => items.filter((other) => other.label !== item.label))} aria-label="측정 삭제"><X size={12} /></button></span>)}</div> : null}<button className="secondary full" onClick={saveEntry} disabled={!molecule}><FolderHeart size={16} /> 현재 분자를 컬렉션에 저장</button></section>
      </aside>
    </div>
    <section className="quick-help" id="quick-help"><HelpCircle size={19} /><div><strong>빠른 사용법</strong><span>① SMILES 입력 또는 구조 그리기 ② 3D에서 원자 클릭 ③ 거리·각도와 노트를 기록 ④ 학습 카드로 저장</span></div></section>
    {collectionOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setCollectionOpen(false)}><section className="collection-modal" role="dialog" aria-modal="true" aria-label="내 컬렉션" onMouseDown={(event) => event.stopPropagation()}><div className="panel-title"><div><span className="eyebrow">LOCAL COLLECTION</span><h2>내 컬렉션</h2></div><button className="icon-button" onClick={() => setCollectionOpen(false)} aria-label="닫기"><X size={17} /></button></div>{storageProblem ? <p className="warning">{storageProblem}</p> : null}{collection.length ? <div className="collection-list">{collection.map((entry) => <article key={entry.id}><button className="collection-load" onClick={() => loadEntry(entry)}><strong>{moleculeDisplayName(entry.molecule.name)}</strong><span>{entry.molecule.formula} · {new Date(entry.savedAt).toLocaleDateString('ko-KR')}</span></button><button className="icon-button danger" onClick={() => removeEntry(entry.id)} aria-label={`${moleculeDisplayName(entry.molecule.name)} 삭제`}><Trash2 size={16} /></button></article>)}</div> : <p className="empty-collection">저장한 분자가 없습니다. 오른쪽 노트에서 현재 분자를 저장해 보세요.</p>}</section></div>}
    {molecule && <StudyCard molecule={molecule} notes={notes} measurements={measurements} vsepr={vsepr} image={captureImage} cardRef={cardRef} />}
  </main>;
}
