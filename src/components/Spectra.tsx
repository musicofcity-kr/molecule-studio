import { useState } from 'react';
import type { Spectrum } from '../types';
import SpectrumRanges from './SpectrumRanges';

export default function Spectra({ spectra }: { spectra: Spectrum[] }) {
  const [active, setActive] = useState('IR');
  const spectrum = spectra.find(item => item.kind === active) ?? spectra[0];
  return <section className="panel spectra" aria-label="분광 참고 범위">
    <div className="panel-title"><div><span className="eyebrow">SPECTRA</span><h2>분광 참고 범위</h2></div><span className="badge">교육용 참고</span></div>
    {spectrum ? <>
      <div className="spectrum-tabs" role="tablist" aria-label="분광 종류">{spectra.map(item => <button role="tab" aria-selected={item.kind === spectrum.kind} className={item.kind === spectrum.kind ? 'selected' : ''} key={item.kind} onClick={() => setActive(item.kind)}>{item.kind}</button>)}</div>
      <SpectrumRanges spectrum={spectrum} />
    </> : <p>분자를 분석하면 규칙이 지원하는 참고 범위를 표시합니다.</p>}
  </section>;
}
