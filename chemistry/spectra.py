"""Broad reference regions; no calculated peaks, intensities or integrals."""

from __future__ import annotations

from rdkit import Chem
from .functional_groups import carbonyl_kind, has_carbonyl
from .vsepr import TRANSITION_METALS


def _region(low: float, high: float, label: str) -> dict:
    return {"range": [low, high], "label": label}


def _spectrum(kind: str, title: str, unit: str, x_min: float, x_max: float,
              regions: list[dict], notice: str, status: str = "available") -> dict:
    return {"kind": kind, "title": title, "unit": unit, "xMin": x_min, "xMax": x_max,
            "peaks": regions, "notice": notice, "supported": bool(regions), "status": status}


def _count(mol: Chem.Mol, smarts: str) -> int:
    query = Chem.MolFromSmarts(smarts)
    return len(mol.GetSubstructMatches(query, uniquify=True)) if query else 0


def ir_spectrum(mol: Chem.Mol) -> dict:
    from collections import Counter
    kinds = Counter(carbonyl_kind(a) for a in mol.GetAtoms() if has_carbonyl(a))
    rules = [
        (kinds["acid"], 2500, 3300, "카복실산 O-H 신축 참고 범위"),
        (_count(mol, "[OX2;H1,H2;!$([O][C,S,P]=O)]"), 3200, 3550, "알코올·페놀·물 O-H 신축 참고 범위"),
        (_count(mol, "[NX3;H1,H2,H3;!$(N[C,S,P]=O)]"), 3300, 3500, "아민·암모니아 N-H 신축"),
        (_count(mol, "[NX3;H1,H2][CX3](=O)"), 3100, 3500, "아마이드 N-H 신축"),
        (_count(mol, "[C]#[N]"), 2210, 2260, "나이트릴 C≡N 신축"),
        (_count(mol, "[C]#[CH]"), 3260, 3335, "말단 알카인 C-H 신축"),
        (kinds["aldehyde"], 2695, 2830, "알데하이드 C-H 신축"),
        (kinds["amide"], 1630, 1690, "아마이드 C=O 신축"),
        (kinds["ester"], 1735, 1750, "에스터 C=O 신축 참고 범위"),
        (kinds["aldehyde"], 1680, 1750, "알데하이드 C=O 신축 참고 범위"),
        (kinds["ketone"], 1680, 1750, "케톤 C=O 신축 참고 범위"),
        (kinds["acid"], 1700, 1725, "카복실산 C=O 신축"),
        (_count(mol, "[C,c]=[C,c]"), 1620, 1680, "C=C 신축"),
        (any(b.GetIsAromatic() for b in mol.GetBonds()), 1450, 1600, "방향족 고리 C=C 영역"),
        (_count(mol, "[CX4;H1,H2,H3]"), 2850, 3000, "sp³ C-H 신축"),
        (_count(mol, "[cH,$([C;H1,H2]=*)]"), 3000, 3100, "sp² C-H 신축"),
    ]
    regions = [_region(low, high, label) for count, low, high, label in rules if count]
    status = "partial" if regions and kinds[None] else "available" if regions else "unsupported"
    notice = "작용기 규칙에 해당하는 참고 범위입니다. 실제 흡수 위치·강도·폭·시료 상태는 계산하지 않습니다. 표시가 없다고 실제 흡수가 없다는 뜻은 아닙니다."
    if kinds[None]:
        notice += " CO₂ 등 현재 규칙에 없는 C=O 결합 환경에는 유기 카보닐 범위를 배정하지 않습니다."
    elif not regions:
        notice += " 현재 구조에 적용할 IR 규칙이 없습니다."
    return _spectrum("IR", "작용기별 IR 참고 범위", "cm⁻¹", 400, 4000, regions, notice, status)


def _proton_environment(h: Chem.Atom) -> tuple[float, float, str] | None:
    attached = h.GetNeighbors()[0]
    if attached.GetFormalCharge() or attached.GetNumRadicalElectrons():
        return None
    symbol = attached.GetSymbol()
    if symbol == "O":
        if any(carbonyl_kind(n) == "acid" for n in attached.GetNeighbors()):
            return 10, 13, "카복실산 O-H"
        return 1, 5.5, "교환 가능한 O-H"
    if symbol == "N":
        return 1, 6, "교환 가능한 N-H"
    if symbol == "S":
        return 1, 4, "S-H"
    if symbol != "C":
        return None
    if has_carbonyl(attached):
        return (9, 10.5, "알데하이드 C-H") if carbonyl_kind(attached) == "aldehyde" else None
    if attached.GetIsAromatic():
        return 6.5, 8.5, "방향족 C-H"
    hybrid = str(attached.GetHybridization())
    if hybrid == "SP2":
        return 4.5, 6.8, "알켄 C-H"
    if hybrid == "SP":
        return 1.8, 3.2, "알카인 C-H"
    neighbors = [n for n in attached.GetNeighbors() if n.GetIdx() != h.GetIdx()]
    if any(n.GetSymbol() in {"O", "N", "F", "Cl", "Br", "I"} for n in neighbors):
        return 3, 4.5, "헤테로 원자에 연결된 탄소의 C-H"
    if any(carbonyl_kind(n) is not None for n in neighbors):
        return 2, 3, "카보닐에 인접한 C-H"
    if any(n.GetIsAromatic() or str(n.GetHybridization()) == "SP2" for n in neighbors):
        return 1.6, 3, "벤질·알릴 C-H"
    return (0.5, 2, "알킬 C-H") if hybrid == "SP3" else None


def _nmr(kind: str, title: str, maximum: float, environments: list) -> dict:
    matched = sorted({env for env in environments if env is not None})
    regions = [_region(low, high, label) for low, high, label in matched]
    status = ("not_applicable" if not environments else "unsupported" if not regions
              else "partial" if None in environments else "available")
    notice = "원자 환경별 넓은 참고 범위입니다. 서로 다른 공명 신호·등가성·분할·결합상수·용매 효과·적분·강도를 계산하지 않습니다. 막대 개수와 크기는 신호 수나 원자 수가 아닙니다."
    if status == "not_applicable":
        notice += " 이 구조에는 해당 원자가 없습니다."
    elif status in {"unsupported", "partial"}:
        notice += " 일부 또는 전체 원자 환경의 자료/규칙이 없어 해당 범위를 제공하지 않습니다."
    return _spectrum(kind, title, "ppm", 0, maximum, regions, notice, status)


def proton_nmr(mol_h: Chem.Mol) -> dict:
    return _nmr("1H NMR", "원자 환경별 ¹H NMR 참고 범위", 14,
                [_proton_environment(a) if a.GetDegree() == 1 else None
                 for a in mol_h.GetAtoms() if a.GetAtomicNum() == 1])


def _carbon_environment(atom: Chem.Atom) -> tuple[float, float, str] | None:
    if atom.GetFormalCharge() or atom.GetNumRadicalElectrons():
        return None
    if has_carbonyl(atom):
        return {
            "acid": (160, 185, "카복실산 카보닐 C"),
            "ester": (160, 185, "에스터 카보닐 C"),
            "amide": (160, 185, "아마이드 카보닐 C"),
            "aldehyde": (190, 205, "알데하이드 카보닐 C"),
            "ketone": (205, 220, "케톤 카보닐 C"),
        }.get(carbonyl_kind(atom))
    if atom.GetIsAromatic():
        return 110, 170, "방향족 C"
    hybrid = str(atom.GetHybridization())
    if hybrid == "SP2":
        return 100, 150, "알켄 C"
    if hybrid == "SP":
        return (65, 90, "알카인 C") if any(b.GetBondTypeAsDouble() == 3 and b.GetOtherAtom(atom).GetSymbol() == "C" for b in atom.GetBonds()) else None
    if hybrid != "SP3":
        return None
    if any(n.GetSymbol() in {"O", "N", "F", "Cl", "Br", "I"} for n in atom.GetNeighbors()):
        return 35, 90, "헤테로 원자에 연결된 sp³ C"
    hydrogens = atom.GetTotalNumHs(includeNeighbors=True)
    if hydrogens >= 3:
        return 10, 30, "일차 알킬 C"
    if hydrogens == 2:
        return 15, 55, "이차 알킬 C"
    return 20, 60, "치환된 알킬 C"


def carbon_nmr(mol: Chem.Mol) -> dict:
    return _nmr("13C NMR", "원자 환경별 ¹³C NMR 참고 범위", 230,
                [_carbon_environment(a) for a in mol.GetAtoms() if a.GetSymbol() == "C"])


def uv_vis_spectrum(mol: Chem.Mol) -> dict:
    problematic = any(a.GetFormalCharge() or a.GetNumRadicalElectrons() or a.GetSymbol() in TRANSITION_METALS
                      or (has_carbonyl(a) and carbonyl_kind(a) is None) for a in mol.GetAtoms())
    conjugated = sum(b.GetIsConjugated() or b.GetIsAromatic() for b in mol.GetBonds())
    aromatic_rings = sum(bool(ring) and all(mol.GetBondWithIdx(i).GetIsAromatic() for i in ring)
                         for ring in mol.GetRingInfo().BondRings())
    notice = "공액 구조의 넓은 흡수 영역 개념도입니다. 계산된 λmax·흡광도·강도가 아니며 용매·치환기·전자 구조에 따라 실제 스펙트럼이 달라집니다."
    if problematic or (conjugated < 2 and not aromatic_rings):
        reason = " CO₂·전하·금속 등 현재 규칙 밖의 전자 구조는 지원하지 않습니다." if problematic else " 현재 규칙이 다루는 공액 발색단을 찾지 못해 참고 범위를 제공하지 않습니다. 실제 흡수가 없다는 뜻은 아닙니다."
        return _spectrum("UV-Vis", "UV–Vis 흡수 영역 개념도", "nm", 190, 800, [], notice + reason, "unsupported" if problematic else "unprovided")
    low, high, label = (220, 450, "넓은 공액·방향족 구조의 개념 영역") if conjugated >= 5 or aromatic_rings >= 2 else (200, 350, "공액·방향족 구조의 개념 영역")
    return _spectrum("UV-Vis", "UV–Vis 흡수 영역 개념도", "nm", 190, 800, [_region(low, high, label)], notice)


def educational_spectra(mol: Chem.Mol, mol_h: Chem.Mol) -> list[dict]:
    return [ir_spectrum(mol), proton_nmr(mol_h), carbon_nmr(mol), uv_vis_spectrum(mol)]
