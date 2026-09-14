"""Conservative local VSEPR classifications for introductory teaching."""

from __future__ import annotations

from rdkit import Chem


TRANSITION_METALS = {
    "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn",
    "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd",
    "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg",
}


_GEOMETRIES = {
    (2, 0): ("AX2", "linear", "linear", "180°"),
    (3, 0): ("AX3", "trigonal planar", "trigonal planar", "120°"),
    (3, 1): ("AX2E", "bent", "trigonal planar", "120°"),
    (4, 0): ("AX4", "tetrahedral", "tetrahedral", "109.5°"),
    (4, 1): ("AX3E", "trigonal pyramidal", "tetrahedral", "109.5°"),
    (4, 2): ("AX2E2", "bent", "tetrahedral", "109.5°"),
    (5, 0): ("AX5", "trigonal bipyramidal", "trigonal bipyramidal", "90°, 120°, 180°"),
    (5, 1): ("AX4E", "seesaw", "trigonal bipyramidal", "90°, 120°, 180°"),
    (5, 2): ("AX3E2", "T-shaped", "trigonal bipyramidal", "90°, 120°, 180°"),
    (5, 3): ("AX2E3", "linear", "trigonal bipyramidal", "90°, 120°, 180°"),
    (6, 0): ("AX6", "octahedral", "octahedral", "90°, 180°"),
    (6, 1): ("AX5E", "square pyramidal", "octahedral", "90°, 180°"),
    (6, 2): ("AX4E2", "square planar", "octahedral", "90°, 180°"),
}


def _unsupported(atom: Chem.Atom, reason: str) -> dict:
    return {
        "atomId": atom.GetIdx(),
        "notation": "unsupported",
        "shape": "not assigned",
        "electronGeometry": "not assigned",
        "lonePairs": None,
        "idealAngles": "not assigned",
        "explanation": reason,
        "supported": False,
    }


def _domain_model(atom: Chem.Atom) -> tuple[int, int] | None:
    """Return (electron domains, lone pairs) only for covered neutral cases."""
    symbol = atom.GetSymbol()
    degree = atom.GetDegree()
    hybrid = str(atom.GetHybridization())

    if symbol in {"C", "Si"}:
        return degree, 0
    if symbol == "B":
        return degree, 0
    if symbol == "N":
        if degree == 3 and hybrid == "SP3":
            return 4, 1
        if degree == 2 and hybrid == "SP2":
            return 3, 1
        if degree == 2 and hybrid == "SP":
            return 2, 1
        # Planar three-coordinate neutral N is commonly resonance controlled;
        # a simple local electron-domain count is misleading.
        return None
    if symbol == "O" and degree == 2:
        return 4, 2
    if symbol in {"S", "Se"} and degree == 2 and hybrid in {"SP3", "UNSPECIFIED"}:
        return 4, 2
    if symbol in {"P", "As"} and degree == 3 and hybrid in {"SP3", "UNSPECIFIED"}:
        return 4, 1
    return None


def classify_vsepr(mol: Chem.Mol) -> list[dict]:
    """Classify heavy-atom local geometry, abstaining outside safe rules.

    Multiple bonds count as one electron domain. Coordinates are not used to
    label the geometry, avoiding circular claims based on the generated model.
    """
    results: list[dict] = []
    for atom in mol.GetAtoms():
        if atom.GetAtomicNum() == 1:
            continue
        symbol = atom.GetSymbol()
        if symbol in TRANSITION_METALS:
            results.append(_unsupported(
                atom,
                f"{symbol}은 전이 금속 중심입니다. 단순 주족 원소 VSEPR 규칙으로 판정하지 않습니다.",
            ))
            continue
        if atom.GetFormalCharge() != 0:
            results.append(_unsupported(
                atom,
                "형식 전하가 있는 원자입니다. 현재 VSEPR 규칙은 전하를 띤 중심 원자를 판정하지 않습니다.",
            ))
            continue
        if atom.GetNumRadicalElectrons():
            results.append(_unsupported(atom, "라디칼 중심은 현재 VSEPR 규칙의 지원 범위 밖입니다."))
            continue
        if atom.GetDegree() < 2:
            results.append(_unsupported(
                atom,
                "이웃 원자가 하나 이하인 말단 원자이므로 국소 분자 형태를 판정하지 않습니다.",
            ))
            continue

        model = _domain_model(atom)
        if model is None or model not in _GEOMETRIES:
            results.append(_unsupported(
                atom,
                "아마이드 등의 결합·공명 환경은 현재 중성 주족 원소 규칙의 지원 범위 밖이므로 판정을 보류합니다.",
            ))
            continue
        domains, lone_pairs = model
        notation, shape, electron_geometry, angles = _GEOMETRIES[(domains, lone_pairs)]
        explanation = (
            f"원자 ID {atom.GetIdx()}: 결합한 원자 {atom.GetDegree()}개, 비공유 전자쌍 영역 {lone_pairs}개입니다. "
            "다중 결합도 전자영역 하나로 셉니다. 전자영역 이상각은 이상 기하의 값이며 현재 모델의 결합각이나 실험값이 아닙니다."
        )
        results.append({
            "atomId": atom.GetIdx(),
            "notation": notation,
            "shape": shape,
            "electronGeometry": electron_geometry,
            "lonePairs": lone_pairs,
            "idealAngles": angles,
            "explanation": explanation,
            "supported": True,
        })
    return results
