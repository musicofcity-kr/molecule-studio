import { CirclePlus, Eraser, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { EditorAtom, EditorBond } from '../types';
import { elementColors, type EditorGraph } from '../lib/chemistry';

type Props = { graph: EditorGraph; onChange: (graph: EditorGraph) => void; onConvert: () => void; disabled?: boolean };
const elements = [
  ['C', '탄소'], ['H', '수소'], ['N', '질소'], ['O', '산소'],
  ['B', '붕소'], ['Si', '규소'], ['P', '인'], ['S', '황'],
  ['F', '플루오린'], ['Cl', '염소'], ['Br', '브로민'], ['I', '아이오딘'],
];

function emptyGraph(): EditorGraph { return { atoms: [], bonds: [] }; }

export default function Sketcher({ graph, onChange, onConvert, disabled }: Props) {
  const [tool, setTool] = useState<'atom' | 'bond' | 'delete'>('atom');
  const [element, setElement] = useState('C');
  const [order, setOrder] = useState(1);
  const [pending, setPending] = useState<number | null>(null);
  const [history, setHistory] = useState<EditorGraph[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => { setPending(null); }, [graph]);
  const bounds = useMemo(() => ({ width: 380, height: 260 }), []);
  const commit = (next: EditorGraph) => { setHistory((previous) => [...previous.slice(-24), graph]); onChange(next); };
  const clear = () => { setHistory((previous) => [...previous.slice(-24), graph]); onChange(emptyGraph()); };
  const makeRing = () => {
    const start = Math.max(0, ...graph.atoms.map((atom) => atom.id)) + 1;
    const atoms = Array.from({ length: 6 }, (_, i) => ({ id: start + i, element: 'C', x: 188 + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * 68, y: 130 + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * 68 }));
    const bonds = atoms.map((atom, i) => ({ a: atom.id, b: atoms[(i + 1) % 6].id, order: i % 2 ? 1 : 2 }));
    commit({ atoms: [...graph.atoms, ...atoms], bonds: [...graph.bonds, ...bonds] });
  };
  const eventPoint = (event: React.PointerEvent<SVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(15, Math.min(bounds.width - 15, (event.clientX - rect.left) * bounds.width / rect.width)), y: Math.max(15, Math.min(bounds.height - 15, (event.clientY - rect.top) * bounds.height / rect.height)) };
  };
  const clickAtom = (id: number) => {
    if (tool === 'delete') { commit({ atoms: graph.atoms.filter((atom) => atom.id !== id), bonds: graph.bonds.filter((bond) => bond.a !== id && bond.b !== id) }); setPending(null); return; }
    if (tool !== 'bond') return;
    if (pending === null) { setPending(id); return; }
    if (pending !== id && !graph.bonds.some((bond) => (bond.a === pending && bond.b === id) || (bond.a === id && bond.b === pending))) commit({ ...graph, bonds: [...graph.bonds, { a: pending, b: id, order }] });
    setPending(null);
  };
  const canvasClick = (event: React.PointerEvent<SVGSVGElement>) => {
    if (tool !== 'atom') return;
    const point = eventPoint(event);
    const id = Math.max(0, ...graph.atoms.map((atom) => atom.id)) + 1;
    commit({ ...graph, atoms: [...graph.atoms, { id, element, ...point }] });
  };
  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragging === null || !dragStart) return;
    const point = eventPoint(event);
    if (Math.hypot(point.x - dragStart.x, point.y - dragStart.y) < 2) return;
    onChange({ ...graph, atoms: graph.atoms.map((atom) => atom.id === dragging ? { ...atom, ...point } : atom) });
  };
  const pointerUp = () => { if (dragging !== null) setHistory((previous) => [...previous.slice(-24), graph]); setDragging(null); setDragStart(null); };

  return <section className="panel sketcher" aria-label="2D 분자 편집기">
    <div className="panel-title"><div><span className="eyebrow">DRAW</span><h2>구조 편집기</h2></div><span className="muted small">원자를 놓고 결합하세요</span></div>
    <div className="tool-row" role="toolbar" aria-label="편집 도구">
      <button className={tool === 'atom' ? 'selected' : ''} onClick={() => setTool('atom')} aria-label="원자 추가"><CirclePlus size={15} /> 원자</button>
      <button className={tool === 'bond' ? 'selected' : ''} onClick={() => setTool('bond')} aria-label="결합 추가">— 결합</button>
      <button className={tool === 'delete' ? 'selected danger' : ''} onClick={() => setTool('delete')} aria-label="원자 삭제"><Eraser size={15} /> 지우기</button>
    </div>
    <div className="element-row" aria-label="원소 선택">{elements.map(([item, name]) => <button key={item} title={`${name} (${item})`} aria-pressed={element === item} className={element === item ? 'element selected' : 'element'} onClick={() => { setElement(item); setTool('atom'); }}><i style={{ background: elementColors[item] }} />{item}<span className="element-name">{name}</span></button>)}</div>
    <div className="bond-row"><span>결합 차수</span>{[1, 2, 3].map((value) => <button key={value} className={order === value ? 'selected' : ''} onClick={() => { setOrder(value); setTool('bond'); }}>{value === 1 ? '단일' : value === 2 ? '이중' : '삼중'}</button>)}<button onClick={makeRing} aria-label="벤젠 고리 추가">⌬ 고리</button></div>
    <svg className="sketch-canvas" viewBox={`0 0 ${bounds.width} ${bounds.height}`} onPointerDown={canvasClick} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={pointerUp} role="img" aria-label="분자 구조 캔버스">
      <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeOpacity=".055" /></pattern></defs><rect width="100%" height="100%" fill="url(#grid)" />
      {graph.bonds.map((bond, index) => { const a = graph.atoms.find((atom) => atom.id === bond.a); const b = graph.atoms.find((atom) => atom.id === bond.b); if (!a || !b) return null; const dx = b.x - a.x; const dy = b.y - a.y; const size = Math.hypot(dx, dy) || 1; const nx = -dy / size * 4; const ny = dx / size * 4; return <g key={`${bond.a}-${bond.b}-${index}`}>{Array.from({ length: bond.order }, (_, line) => { const shift = (line - (bond.order - 1) / 2); return <line key={line} x1={a.x + nx * shift} y1={a.y + ny * shift} x2={b.x + nx * shift} y2={b.y + ny * shift} className="bond-line" />; })}</g>; })}
      {graph.atoms.map((atom) => <g key={atom.id} className={`sketch-atom ${pending === atom.id ? 'pending' : ''}`} onPointerDown={(event) => { event.stopPropagation(); setDragging(atom.id); setDragStart(eventPoint(event)); }} onClick={(event) => { event.stopPropagation(); clickAtom(atom.id); }}><circle cx={atom.x} cy={atom.y} r="16" fill={elementColors[atom.element] ?? '#64748b'} /><text x={atom.x} y={atom.y + 5} textAnchor="middle" style={{ fill: atom.element === 'H' ? '#334155' : '#fff' }}>{atom.element}</text></g>)}
      {!graph.atoms.length && <text x="190" y="122" textAnchor="middle" className="canvas-hint">원소를 선택한 뒤 빈 공간을 클릭하세요</text>} {pending !== null && <text x="190" y="238" textAnchor="middle" className="canvas-hint">다른 원자를 선택하여 결합</text>}
    </svg>
    <div className="sketch-footer"><span>{graph.atoms.length} atoms · {graph.bonds.length} bonds</span><div><button className="icon-button" onClick={() => { const previous = history.at(-1); if (previous) { onChange(previous); setHistory(history.slice(0, -1)); } }} disabled={!history.length} aria-label="되돌리기"><RotateCcw size={16} /></button><button className="icon-button" onClick={clear} disabled={!graph.atoms.length} aria-label="모두 지우기"><Trash2 size={16} /></button><button className="primary compact" onClick={onConvert} disabled={!graph.atoms.length || disabled}>3D 만들기</button></div></div>
  </section>;
}
