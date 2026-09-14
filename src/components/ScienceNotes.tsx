import type { Molecule, Vsepr } from '../types';
import { legacyNotice } from '../lib/education';

export function HydrogenBondNotes({ molecule, compact = false }: { molecule: Molecule; compact?: boolean }) {
  const info = molecule.hydrogenBonding;
  if (!info) return <p className="science-note">{legacyNotice}</p>;
  const definition = <><p>{info.definition}</p><p>{info.hydrogenHandling}</p><p>{info.library} · {info.functions}</p><a href={info.source} target="_blank" rel="noreferrer">RDKit 집계 규칙</a></>;
  return <section className="hydrogen-bond-notes">
    <p>{info.note}</p>
    <div className="descriptor-counts"><span>수소 결합 주개 (HBD): <b>{molecule.properties.hbd} 부위</b></span><span>수소 결합 받개 (HBA): <b>{molecule.properties.hba} 부위</b></span></div>
    {compact ? <div className="descriptor-definition">{definition}</div> : <details><summary>원시 지표의 정의·적용 범위</summary>{definition}</details>}
  </section>;
}

export function GeometryNotes({ molecule, vsepr }: { molecule: Molecule; vsepr: Vsepr | null }) {
  const reference = molecule.geometryReference;
  return <div className="geometry-notes">
    {vsepr?.supported && <p>전자영역 배치의 이상각: <b>{vsepr.idealAngles}</b><small>이상 기하의 각도이며 현재 모델의 결합각과 다를 수 있습니다.</small></p>}
    {reference && <div className="geometry-reference"><strong>{reference.title}</strong><p>H–O–H {reference.angle}{reference.angleUnit} · O–H {reference.length} {reference.lengthUnit}</p><a href={reference.url} target="_blank" rel="noreferrer">{reference.source}</a><small>{reference.notice}</small></div>}
  </div>;
}
