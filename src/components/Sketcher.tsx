import { CirclePlus, Eraser, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { EditorAtom, EditorBond } from '../types';
import { elementColors, type EditorGraph } from '../lib/chemistry';
import './Sketcher.css';

type Props = { graph: EditorGraph; onChange: (graph: EditorGraph) => void; onConvert: () => void; disabled?: boolean };
type Tool = 'atom' | 'bond' | 'delete';
type Drag = { atomId: number; clientX: number; clientY: number; before: EditorGraph; moved: boolean };
const elements = [['C', '탄소'], ['H', '수소'], ['N', '질소'], ['O', '산소'], ['B', '붕소'], ['Si', '규소'], ['P', '인'], ['S', '황'], ['F', '플루오린'], ['Cl', '염소'], ['Br', '브로민'], ['I', '아이오딘']];
const emptyGraph = (): EditorGraph => ({ atoms: [], bonds: [] });
const copyGraph = (value: EditorGraph): EditorGraph => ({ atoms: value.atoms.map((atom) => ({ ...atom })), bonds: value.bonds.map((bond) => ({ ...bond })) });
const sameGraph = (a: EditorGraph, b: EditorGraph) => a.atoms.length === b.atoms.length && a.bonds.length === b.bonds.length && a.atoms.every((atom, index) => { const other = b.atoms[index]; return other?.id === atom.id && other.element === atom.element && other.x === atom.x && other.y === atom.y && other.charge === atom.charge; }) && a.bonds.every((bond, index) => { const other = b.bonds[index]; return other?.a === bond.a && other.b === bond.b && other.order === bond.order; });
const matchesBond = (bond: EditorBond, a: number, b: number) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a);

export default function Sketcher({ graph, onChange, onConvert, disabled }: Props) {
  const [tool, setTool] = useState<Tool>('atom');
  const [element, setElement] = useState('C');
  const [order, setOrder] = useState(1);
  const [pending, setPending] = useState<number | null>(null);
  const [history, setHistory] = useState<EditorGraph[]>([]);
  const [feedback, setFeedback] = useState('원소를 선택한 뒤 빈 공간을 누르세요.');
  const bounds = useMemo(() => ({ width: 380, height: 260 }), []);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const graphRef = useRef(graph);
  const emittedGraphRef = useRef<EditorGraph | null>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    graphRef.current = graph;
    if (emittedGraphRef.current === graph) { emittedGraphRef.current = null; return; }
    setHistory([]); setPending(null); dragRef.current = null;
  }, [graph]);
  useEffect(() => {
    if (disabled) { dragRef.current = null; setPending(null); }
  }, [disabled]);
  const emit = (next: EditorGraph) => { emittedGraphRef.current = next; graphRef.current = next; onChange(next); };
  const commit = (next: EditorGraph, before = graphRef.current) => { if (!sameGraph(before, next)) { setHistory((previous) => [...previous.slice(-24), copyGraph(before)]); emit(next); } };
  const chooseTool = (next: Tool, message: string) => { if (!disabled) { setTool(next); setPending(null); setFeedback(message); } };
  const chooseOrder = (next: number) => { if (!disabled) { setOrder(next); chooseTool('bond', `${next === 1 ? '단일' : next === 2 ? '이중' : '삼중'} 결합: 두 원자 또는 기존 결합선을 선택하세요.`); } };
  const point = (event: PointerEvent<SVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 190, y: 130 };
    return { x: Math.max(15, Math.min(365, (event.clientX - rect.left) * bounds.width / rect.width)), y: Math.max(15, Math.min(245, (event.clientY - rect.top) * bounds.height / rect.height)) };
  };
  const clear = () => { if (!disabled) { commit(emptyGraph()); setPending(null); setFeedback('구조를 모두 지웠습니다.'); } };
  const makeRing = () => {
    if (disabled) return;
    const current = graphRef.current, start = Math.max(0, ...current.atoms.map((atom) => atom.id)) + 1;
    const atoms = Array.from({ length: 6 }, (_, i) => ({ id: start + i, element: 'C', x: 188 + Math.cos(i * Math.PI / 3 - Math.PI / 2) * 68, y: 130 + Math.sin(i * Math.PI / 3 - Math.PI / 2) * 68 }));
    commit({ atoms: [...current.atoms, ...atoms], bonds: [...current.bonds, ...atoms.map((atom, i) => ({ a: atom.id, b: atoms[(i + 1) % 6].id, order: i % 2 ? 1 : 2 }))] }, current); setFeedback('벤젠 고리를 추가했습니다.');
  };
  const clickAtom = (id: number) => {
    if (disabled) return;
    const current = graphRef.current;
    if (tool === 'delete') { commit({ atoms: current.atoms.filter((atom) => atom.id !== id), bonds: current.bonds.filter((bond) => bond.a !== id && bond.b !== id) }, current); setPending(null); setFeedback('원자와 연결된 결합을 지웠습니다.'); return; }
    if (tool !== 'bond') return;
    if (pending === null) { setPending(id); setFeedback('두 번째 원자를 선택하면 결합을 만듭니다.'); return; }
    if (pending === id) { setPending(null); setFeedback('결합 선택을 취소했습니다.'); return; }
    const existing = current.bonds.find((bond) => matchesBond(bond, pending, id));
    if (existing) {
      if (existing.order === order) setFeedback('이미 선택한 차수의 결합입니다.');
      else { commit({ ...current, bonds: current.bonds.map((bond) => matchesBond(bond, pending, id) ? { ...bond, order } : bond) }, current); setFeedback('기존 결합 차수를 바꿨습니다.'); }
    } else { commit({ ...current, bonds: [...current.bonds, { a: pending, b: id, order }] }, current); setFeedback('새 결합을 만들었습니다.'); }
    setPending(null);
  };
  const clickBond = (index: number) => {
    if (disabled) return;
    const current = graphRef.current, bond = current.bonds[index]; if (!bond) return;
    if (tool === 'delete') { commit({ ...current, bonds: current.bonds.filter((_, itemIndex) => itemIndex !== index) }, current); setFeedback('결합만 지웠습니다. 원자는 유지됩니다.'); }
    else if (tool === 'bond') { if (bond.order === order) setFeedback('이미 선택한 차수의 결합입니다.'); else { commit({ ...current, bonds: current.bonds.map((item, itemIndex) => itemIndex === index ? { ...item, order } : item) }, current); setFeedback('기존 결합 차수를 바꿨습니다.'); } setPending(null); }
  };
  const canvasDown = (event: PointerEvent<SVGSVGElement>) => {
    if (disabled || tool !== 'atom' || event.target !== event.currentTarget) return;
    const current = graphRef.current, id = Math.max(0, ...current.atoms.map((atom) => atom.id)) + 1;
    commit({ ...current, atoms: [...current.atoms, { id, element, ...point(event) }] }, current); setFeedback(`${element} 원자를 추가했습니다.`);
  };
  const atomDown = (event: PointerEvent<SVGGElement>, id: number) => {
    event.stopPropagation(); if (disabled || tool !== 'atom') return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { atomId: id, clientX: event.clientX, clientY: event.clientY, before: copyGraph(graphRef.current), moved: false };
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current; if (disabled || !drag || tool !== 'atom') return;
    // Threshold is in screen pixels: two pixels remains a click at every SVG size.
    if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 6) return;
    drag.moved = true; const current = graphRef.current, nextPoint = point(event);
    emit({ ...current, atoms: current.atoms.map((atom) => atom.id === drag.atomId ? { ...atom, ...nextPoint } : atom) });
  };
  const finish = () => { const drag = dragRef.current; dragRef.current = null; if (!disabled && drag?.moved) { setHistory((previous) => [...previous.slice(-24), drag.before]); setFeedback('원자 위치를 옮겼습니다. 되돌리기로 이전 위치를 복원할 수 있습니다.'); } };
  const cancel = () => { const drag = dragRef.current; dragRef.current = null; if (drag?.moved) emit(drag.before); };
  const undo = () => { const previous = history.at(-1); if (disabled || !previous) return; setHistory((items) => items.slice(0, -1)); emit(copyGraph(previous)); setPending(null); setFeedback('마지막 편집을 되돌렸습니다.'); };

  return <section className="panel sketcher" aria-label="2D 분자 편집기">
    <div className="panel-title"><div><span className="eyebrow">DRAW</span><h2>구조 편집기</h2></div><span className="muted small">원자를 놓고 결합하세요</span></div>
    <div className="tool-row" role="toolbar" aria-label="편집 도구">
      <button disabled={disabled} className={tool === 'atom' ? 'selected' : ''} onClick={() => chooseTool('atom', '원소를 선택한 뒤 빈 공간을 누르세요.')} aria-label="원자 추가"><CirclePlus size={15} /> 원자</button>
      <button disabled={disabled} className={tool === 'bond' ? 'selected' : ''} onClick={() => chooseTool('bond', '두 원자 또는 기존 결합선을 선택하세요.')} aria-label="결합 추가">— 결합</button>
      <button disabled={disabled} className={tool === 'delete' ? 'selected danger' : ''} onClick={() => chooseTool('delete', '원자 또는 결합선을 선택해 지우세요.')} aria-label="원자 또는 결합 삭제"><Eraser size={15} /> 지우기</button>
    </div>
    <div className="element-row" aria-label="원소 선택">{elements.map(([item, name]) => <button disabled={disabled} key={item} title={`${name} (${item})`} aria-pressed={element === item} className={element === item ? 'element selected' : 'element'} onClick={() => { setElement(item); chooseTool('atom', `${name} 원소를 선택했습니다. 빈 공간을 누르세요.`); }}><i style={{ background: elementColors[item] }} />{item}<span className="element-name">{name}</span></button>)}</div>
    <div className="bond-row"><span>결합 차수</span>{[1, 2, 3].map((value) => <button disabled={disabled} key={value} className={tool === 'bond' && order === value ? 'selected' : ''} onClick={() => chooseOrder(value)}>{value === 1 ? '단일' : value === 2 ? '이중' : '삼중'}</button>)}<button disabled={disabled} onClick={makeRing} aria-label="벤젠 고리 추가">⌬ 고리</button></div>
    <p className="sketch-feedback" aria-live="polite">{disabled ? '3D 구조를 계산하는 동안 편집이 잠시 잠깁니다.' : feedback}</p>
    <svg ref={svgRef} className="sketch-canvas" viewBox={`0 0 ${bounds.width} ${bounds.height}`} onPointerDown={canvasDown} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} role="img" aria-label="분자 구조 캔버스">
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeOpacity=".055" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" pointerEvents="none" />
      {graph.bonds.map((bond, index) => { const a = graph.atoms.find((atom) => atom.id === bond.a), b = graph.atoms.find((atom) => atom.id === bond.b); if (!a || !b) return null; const dx = b.x - a.x, dy = b.y - a.y, size = Math.hypot(dx, dy) || 1, nx = -dy / size * 4, ny = dx / size * 4; return <g key={`${bond.a}-${bond.b}-${index}`} className="sketch-bond" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); clickBond(index); }}>{Array.from({ length: bond.order }, (_, line) => { const shift = line - (bond.order - 1) / 2; return <line key={line} x1={a.x + nx * shift} y1={a.y + ny * shift} x2={b.x + nx * shift} y2={b.y + ny * shift} className="bond-line" />; })}<line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="bond-hit-area" /></g>; })}
      {graph.atoms.map((atom: EditorAtom) => <g key={atom.id} className={`sketch-atom ${pending === atom.id ? 'pending' : ''}`} onPointerDown={(event) => atomDown(event, atom.id)} onClick={(event) => { event.stopPropagation(); clickAtom(atom.id); }}><circle cx={atom.x} cy={atom.y} r="16" fill={elementColors[atom.element] ?? '#64748b'} /><text x={atom.x} y={atom.y + 5} textAnchor="middle" style={{ fill: atom.element === 'H' ? '#334155' : '#fff' }}>{atom.element}</text></g>)}
      {!graph.atoms.length && <text x="190" y="122" textAnchor="middle" className="canvas-hint">원소를 선택하고 빈 공간을 누르세요</text>}{pending !== null && <text x="190" y="238" textAnchor="middle" className="canvas-hint">다른 원자를 선택하여 결합</text>}
    </svg>
    <div className="sketch-footer"><span>{graph.atoms.length} atoms · {graph.bonds.length} bonds</span><div><button className="icon-button" onClick={undo} disabled={!history.length || disabled} aria-label="되돌리기"><RotateCcw size={16} /></button><button className="icon-button" onClick={clear} disabled={!graph.atoms.length || disabled} aria-label="모두 지우기"><Trash2 size={16} /></button><button className="primary compact" onClick={onConvert} disabled={!graph.atoms.length || disabled}>3D 만들기</button></div></div>
  </section>;
}
