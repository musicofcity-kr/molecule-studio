import type { Molecule, Spectrum } from '../types';

export const legacyNotice = '이전 버전으로 저장된 자료입니다. 구조·노트·모델 측정 기록은 유지하며, 과학 설명과 참고 범위는 제공을 보류합니다. SMILES를 다시 분석하면 새 해석을 볼 수 있습니다.';

export function savedMoleculeForDisplay(molecule: Molecule): Molecule {
  if (molecule.analysisVersion === 2) return molecule;
  const kinds: [string, string, number, number][] = [['IR', 'cm⁻¹', 400, 4000], ['1H NMR', 'ppm', 0, 14], ['13C NMR', 'ppm', 0, 230], ['UV-Vis', 'nm', 190, 800]];
  return { ...molecule, vsepr: [], hydrogenBonding: undefined, geometryReference: null,
    warnings: [legacyNotice], method: '이전 버전의 저장 모델 (계산 방법 설명 재확인 필요)',
    spectra: kinds.map(([kind, unit, xMin, xMax]): Spectrum => ({ kind, unit, xMin, xMax, title: `${kind} 참고 범위`, peaks: [], supported: false, status: 'unprovided', notice: legacyNotice })) };
}

export const spectrumStatus = { available: '참고 범위', partial: '일부 규칙 미지원', unsupported: '자료/규칙 미지원', not_applicable: '해당 원자 없음', unprovided: '참고 범위 미제공' };
