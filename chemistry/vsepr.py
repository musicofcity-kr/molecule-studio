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
    (3, 1): ("AX2E", "bent", "trigonal planar", "<120°"),
    (4, 0): ("AX4", "tetrahedral", "tetrahedral", "109.5°"),
    (4, 1): ("AX3E", "trigonal pyramidal", "tetrahedral", "about 107°"),
    (4, 2): ("AX2E2", "bent", "tetrahedral", "about 104.5° for H2O"),
    (5, 0): ("AX5", "trigonal bipyramidal", "trigonal bipyramidal", "90°, 120°, 180°"),
    (5, 1): ("AX4E", "seesaw", "trigonal bipyramidal", "<90°, <120°, 180°"),
    (5, 2): ("AX3E2", "T-shaped", "trigonal bipyramidal", "about 90°, 180°"),
    (5, 3): ("AX2E3", "linear", "trigonal bipyramidal", "180°"),
    (6, 0): ("AX6", "octahedral", "octahedral", "90°, 180°"),
    (6, 1): ("AX5E", "square pyramidal", "octahedral", "about 90°, 180°"),
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
                f"{symbol} is a transition-metal center; simple main-group VSEPR rules are not applied.",
            ))
            continue
        if atom.GetFormalCharge() != 0:
            results.append(_unsupported(
                atom,
                "This atom carries formal charge; this conservative local classifier does not assign charged centers.",
            ))
            continue
        if atom.GetNumRadicalElectrons():
            results.append(_unsupported(atom, "Radical centers are outside this local VSEPR rule set."))
            continue
        if atom.GetDegree() < 2:
            results.append(_unsupported(
                atom,
                "A terminal atom has only one bonded neighbor, so a local molecular shape is not informative.",
            ))
            continue

        model = _domain_model(atom)
        if model is None or model not in _GEOMETRIES:
            results.append(_unsupported(
                atom,
                "The bonding or resonance pattern is outside the covered neutral main-group rules.",
            ))
            continue
        domains, lone_pairs = model
        notation, shape, electron_geometry, angles = _GEOMETRIES[(domains, lone_pairs)]
        explanation = (
            f"Atom {atom.GetIdx()} has {atom.GetDegree()} bonded atoms and {lone_pairs} local lone-pair "
            f"domain{'s' if lone_pairs != 1 else ''}; multiple bonds count as one VSEPR domain."
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
