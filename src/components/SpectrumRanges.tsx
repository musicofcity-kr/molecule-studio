import type { Spectrum } from '../types';
import { spectrumStatus } from '../lib/education';

/** Screen and PNG use the same ranges and Korean limits; no simulated peaks. */
export default function SpectrumRanges({ spectrum }: { spectrum: Spectrum }) {
  const regions = spectrum.peaks.filter((item) => item.range && item.range.every(Number.isFinite));
  const reversed = spectrum.kind === 'IR' || spectrum.kind.includes('NMR');
  const span = spectrum.xMax - spectrum.xMin || 1;
  const x = (value: number) => 32 + (reversed ? 1 - (value - spectrum.xMin) / span : (value - spectrum.xMin) / span) * 336;
  const height = Math.max(82, 46 + regions.length * 20);
  const status = spectrumStatus[spectrum.status ?? 'unprovided'];
  return <div className="spectrum-ranges">
    <div className="spectrum-name"><strong>{spectrum.title}</strong><span>{status}</span></div>
    {regions.length ? <>
      <svg viewBox={`0 0 400 ${height}`} role="img" aria-label={`${spectrum.title} 구간 막대`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {regions.map((region, index) => {
          const [low, high] = region.range!;
          return <g key={`${low}-${high}-${region.label}`}>
            <text x="4" y={24 + index * 20} fill="#526b74" fontSize="10">{index + 1}</text>
            <rect data-region={region.label} x={Math.min(x(low), x(high))} y={14 + index * 20} width={Math.max(1, Math.abs(x(high) - x(low)))} height="12" rx="2" fill="#b1dcd3" stroke="#27796f" strokeWidth="1"><title>{region.label}: {low}–{high} {spectrum.unit}</title></rect>
          </g>;
        })}
        <line x1="32" x2="368" y1={height - 24} y2={height - 24} stroke="#9caeae" />
        {[0, 1, 2, 3, 4].map((i) => { const value = spectrum.xMin + span * i / 4; return <text key={i} x={x(value)} y={height - 8} textAnchor="middle" fill="#526b74" fontSize="10">{Number(value.toFixed(2))}</text>; })}
      </svg>
      <p className="range-scale">가로축: {spectrum.unit} · 세로 순서는 항목 구분용이며 강도·적분이 아닙니다.</p>
      <ol className="range-list">{regions.map((region) => <li key={`${region.label}-${region.range}`}><b>{region.range![0]}–{region.range![1]} {spectrum.unit}</b><span>{region.label}</span></li>)}</ol>
    </> : <p className="range-empty">{status}</p>}
    <p className="range-notice">{spectrum.notice}</p>
  </div>;
}
