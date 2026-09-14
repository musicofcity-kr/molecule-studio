import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Spectrum } from '../types';

type Props = { spectra: Spectrum[] };
const ordered = ['IR', '1H NMR', '13C NMR', 'UV-Vis'];

function normalizedPeaks(spectrum: Spectrum) {
  const span = spectrum.xMax - spectrum.xMin || 1;
  return spectrum.peaks.map((peak) => ({ ...peak, x: Math.max(0, Math.min(1, (peak.position - spectrum.xMin) / span)), y: Math.max(.08, Math.min(1, peak.intensity > 1 ? peak.intensity / 100 : peak.intensity)) }));
}

export default function Spectra({ spectra }: Props) {
  const sorted = useMemo(() => [...spectra].sort((a, b) => (ordered.indexOf(a.kind) + 10).toString().localeCompare((ordered.indexOf(b.kind) + 10).toString()) || a.title.localeCompare(b.title)), [spectra]);
  const [active, setActive] = useState(0);
  const spectrum = sorted[active] ?? null;
  if (!spectrum) return <section className="panel spectra empty-spectrum"><div className="panel-title"><div><span className="eyebrow">SPECTRA</span><h2>예측 스펙트럼</h2></div></div><p>분자를 분석하면 교육용 예측 피크가 이곳에 표시됩니다.</p></section>;
  const peaks = normalizedPeaks(spectrum);
  const tickValues = Array.from({ length: 5 }, (_, index) => spectrum.xMin + (spectrum.xMax - spectrum.xMin) * index / 4);
  const reversed = spectrum.kind.toUpperCase().includes('IR') || spectrum.kind.toUpperCase().includes('NMR');
  return <section className="panel spectra" aria-label="예측 스펙트럼">
    <div className="panel-title"><div><span className="eyebrow">SPECTRA</span><h2>예측 스펙트럼</h2></div><span className={spectrum.supported ? 'badge' : 'badge muted-badge'}>{spectrum.supported ? '교육용 예측' : '제한됨'}</span></div>
    <div className="spectrum-tabs" role="tablist">{sorted.map((item, index) => <button role="tab" aria-selected={active === index} className={active === index ? 'selected' : ''} key={`${item.kind}-${index}`} onClick={() => setActive(index)}>{item.kind}</button>)}</div>
    <div className="spectrum-card">
      <div className="spectrum-name"><strong>{spectrum.title}</strong><span>{spectrum.xMin}–{spectrum.xMax} {spectrum.unit}</span></div>
      <svg viewBox="0 0 640 215" className="spectrum-chart" role="img" aria-label={`${spectrum.title} 피크 그래프`} preserveAspectRatio="none">
        {[.2, .4, .6, .8].map((line) => <line key={line} x1="42" x2="622" y1={20 + line * 155} y2={20 + line * 155} className="chart-grid" />)}
        <line x1="42" x2="622" y1="175" y2="175" className="chart-axis" />
        {peaks.map((peak, index) => { const x = 42 + (reversed ? 1 - peak.x : peak.x) * 580; const y = 175 - peak.y * 145; return <g key={`${peak.position}-${index}`} className="peak"><line x1={x} x2={x} y1="175" y2={y} /><circle cx={x} cy={y} r="3" /><text x={x} y={y - 9} textAnchor="middle">{peak.position}</text></g>; })}
        {tickValues.map((value, index) => { const x = 42 + (reversed ? 1 - index / 4 : index / 4) * 580; return <text key={value} x={x} y="200" textAnchor="middle" className="chart-label">{Math.round(value)}</text>; })}
      </svg>
      <div className="spectrum-unit">{spectrum.unit}</div>
    </div>
    <div className="peak-list">{spectrum.peaks.slice(0, 4).map((peak, index) => <span key={`${peak.position}-${index}`}><b>{peak.position} {spectrum.unit}</b>{peak.label}</span>)}</div>
    <p className="notice"><Info size={14} />{spectrum.notice || '피크 위치는 구조 학습을 돕는 추정값이며, 실제 기기 측정값을 대신하지 않습니다.'}</p>
  </section>;
}
