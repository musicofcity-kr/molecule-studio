"""Rule-based educational spectrum regions, never instrument predictions."""

from __future__ import annotations

from collections import defaultdict

from rdkit import Chem

from .vsepr import TRANSITION_METALS


def _peak(low: float, high: float, intensity: float, label: str, count: int | None = None) -> dict:
    value = {
        "position": round((low + high) / 2, 3),
        "intensity": intensity,
        "label": label,
        "range": [low, high],
    }
    if count is not None:
        value["count"] = count
    return value


def _spectrum(kind: str, title: str, unit: str, x_min: float, x_max: float,
              peaks: list[dict], notice: str, supported: bool) -> dict:
    return {
        "kind": kind,
        "title": title,
        "unit": unit,
        "xMin": x_min,
        "xMax": x_max,
        "peaks": peaks,
        "notice": notice,
        "supported": supported,
    }


def _has(mol: Chem.Mol, smarts: str) -> bool:
    query = Chem.MolFromSmarts(smarts)
    return bool(query and mol.HasSubstructMatch(query))


def _count(mol: Chem.Mol, smarts: str) -> int:
    query = Chem.MolFromSmarts(smarts)
    return len(mol.GetSubstructMatches(query, uniquify=True)) if query else 0


def ir_spectrum(mol: Chem.Mol) -> dict:
    bands: list[tuple[float, float, float, str, int]] = []

    acid = _count(mol, "[CX3](=O)[OX2H1]")
    alcohol = _count(mol, "[OX2;H1,H2;!$([O][C,S,P]=O)]")
    amine_h = _count(mol, "[NX3;H1,H2,H3;!$(N[C,S,P]=O)]")
    amide_h = _count(mol, "[NX3;H1,H2][CX3](=O)")
    nitrile = _count(mol, "[C]#[N]")
    alkyne_h = _count(mol, "[C]#[CH]")
    alkene = _count(mol, "[C,c]=[C,c]")
    aromatic = sum(1 for bond in mol.GetBonds() if bond.GetIsAromatic())
    aldehyde = _count(mol, "[CX3H1](=O)[#6]")
    ester = _count(mol, "[CX3](=O)[OX2][#6]")
    amide = _count(mol, "[CX3](=O)[NX3]")
    carbonyl = _count(mol, "[CX3]=[OX1]")

    if acid:
        bands.append((2500, 3300, 0.9, "carboxylic-acid O-H stretch (broad)", acid))
    if alcohol:
        bands.append((3200, 3550, 0.85, "alcohol/phenol/water O-H stretch (broad)", alcohol))
    if amine_h:
        bands.append((3300, 3500, 0.65, "amine/ammonia N-H stretch", amine_h))
    if amide_h:
        bands.append((3100, 3500, 0.7, "amide N-H stretch", amide_h))
    if nitrile:
        bands.append((2210, 2260, 0.7, "nitrile C≡N stretch", nitrile))
    if alkyne_h:
        bands.append((3260, 3335, 0.65, "terminal alkyne C-H stretch", alkyne_h))
    if aldehyde:
        bands.append((2695, 2830, 0.45, "aldehyde C-H stretch region", aldehyde))
    if carbonyl:
        if amide:
            bands.append((1630, 1690, 0.95, "amide C=O stretch", amide))
        if ester:
            bands.append((1735, 1750, 0.95, "saturated ester C=O stretch", ester))
        remaining = max(0, carbonyl - amide - ester - acid)
        if remaining:
            bands.append((1680, 1750, 1.0, "aldehyde/ketone C=O stretch", remaining))
        if acid:
            bands.append((1700, 1725, 1.0, "carboxylic-acid C=O stretch", acid))
    if alkene:
        bands.append((1620, 1680, 0.55, "C=C stretch", alkene))
    if aromatic:
        bands.append((1450, 1600, 0.5, "aromatic-ring C=C region", aromatic))
    if _has(mol, "[CX4;H1,H2,H3]"):
        bands.append((2850, 3000, 0.6, "sp3 C-H stretch region", _count(mol, "[CX4;H1,H2,H3]")))
    if _has(mol, "[cH,$([C;H1,H2]=*)]"):
        bands.append((3000, 3100, 0.45, "sp2 C-H stretch region", _count(mol, "[cH,$([C;H1,H2]=*)]")))

    peaks = [_peak(low, high, strength, label, count) for low, high, strength, label, count in bands]
    return _spectrum(
        "IR",
        "Educational IR regions",
        "cm⁻¹",
        400,
        4000,
        peaks,
        "Rule-based functional-group ranges only; band position, intensity, width, and sample effects are not calculated.",
        bool(peaks),
    )


def _is_carbonyl_carbon(atom: Chem.Atom) -> bool:
    return any(
        bond.GetBondTypeAsDouble() == 2 and bond.GetOtherAtom(atom).GetSymbol() == "O"
        for bond in atom.GetBonds()
    )


def _proton_environment(hydrogen: Chem.Atom) -> tuple[float, float, str]:
    attached = hydrogen.GetNeighbors()[0]
    symbol = attached.GetSymbol()
    if symbol == "O":
        if any(_is_carbonyl_carbon(nbr) for nbr in attached.GetNeighbors() if nbr.GetSymbol() == "C"):
            return 10.0, 13.0, "carboxylic-acid O-H"
        return 1.0, 5.5, "exchangeable O-H"
    if symbol == "N":
        return 1.0, 6.0, "exchangeable N-H"
    if symbol == "S":
        return 1.0, 4.0, "S-H"
    if symbol != "C":
        return 0.0, 12.0, f"H attached to {symbol} (broad reference only)"
    if _is_carbonyl_carbon(attached):
        return 9.0, 10.5, "aldehydic C-H"
    if attached.GetIsAromatic():
        return 6.5, 8.5, "aromatic C-H"
    hybrid = str(attached.GetHybridization())
    if hybrid == "SP2":
        return 4.5, 6.8, "vinylic C-H"
    if hybrid == "SP":
        return 1.8, 3.2, "acetylenic C-H"
    neighbors = [n for n in attached.GetNeighbors() if n.GetIdx() != hydrogen.GetIdx()]
    if any(n.GetSymbol() in {"O", "N", "F", "Cl", "Br", "I"} for n in neighbors):
        return 3.0, 4.5, "C-H on carbon bonded to heteroatom"
    if any(n.GetSymbol() == "C" and _is_carbonyl_carbon(n) for n in neighbors):
        return 2.0, 3.0, "C-H alpha to carbonyl"
    if any(n.GetIsAromatic() or str(n.GetHybridization()) == "SP2" for n in neighbors):
        return 1.6, 3.0, "benzylic/allylic C-H"
    return 0.5, 2.0, "alkyl C-H"


def proton_nmr(mol_h: Chem.Mol) -> dict:
    grouped: dict[tuple[float, float, str], int] = defaultdict(int)
    for atom in mol_h.GetAtoms():
        if atom.GetAtomicNum() == 1 and atom.GetDegree() == 1:
            grouped[_proton_environment(atom)] += 1
    peaks = [
        _peak(low, high, 0.65, label, count)
        for (low, high, label), count in sorted(grouped.items(), key=lambda item: item[0][0])
    ]
    return _spectrum(
        "1H NMR",
        "Educational ¹H NMR regions",
        "ppm",
        0,
        14,
        peaks,
        "Broad environment ranges only; entries are not distinct resonances, and equivalence, splitting, coupling, solvent, and integration are not predicted. Count is the number of matched explicit H atoms.",
        bool(peaks),
    )


def _carbon_environment(atom: Chem.Atom) -> tuple[float, float, str]:
    if _is_carbonyl_carbon(atom):
        single_neighbors = [
            bond.GetOtherAtom(atom)
            for bond in atom.GetBonds()
            if bond.GetBondTypeAsDouble() == 1
        ]
        if any(n.GetSymbol() in {"O", "N", "S"} for n in single_neighbors):
            return 160.0, 185.0, "acid-derivative carbonyl C"
        if atom.GetTotalNumHs() > 0:
            return 190.0, 205.0, "aldehyde carbonyl C"
        return 205.0, 220.0, "ketone carbonyl C"
    if atom.GetIsAromatic():
        return 110.0, 170.0, "aromatic C"
    hybrid = str(atom.GetHybridization())
    if hybrid == "SP2":
        return 100.0, 150.0, "alkene C"
    if hybrid == "SP":
        return 65.0, 90.0, "alkyne C"
    if any(n.GetSymbol() in {"O", "N", "F", "Cl", "Br", "I"} for n in atom.GetNeighbors()):
        return 35.0, 90.0, "sp3 C bonded to heteroatom"
    hydrogens = atom.GetTotalNumHs()
    if hydrogens >= 3:
        return 10.0, 30.0, "primary alkyl C"
    if hydrogens == 2:
        return 15.0, 55.0, "secondary alkyl C"
    return 20.0, 60.0, "substituted alkyl C"


def carbon_nmr(mol: Chem.Mol) -> dict:
    grouped: dict[tuple[float, float, str], int] = defaultdict(int)
    for atom in mol.GetAtoms():
        if atom.GetSymbol() == "C":
            grouped[_carbon_environment(atom)] += 1
    peaks = [
        _peak(low, high, 0.65, label, count)
        for (low, high, label), count in sorted(grouped.items(), key=lambda item: item[0][0])
    ]
    return _spectrum(
        "13C NMR",
        "Educational ¹³C NMR regions",
        "ppm",
        0,
        230,
        peaks,
        "Broad carbon-environment ranges only; entries are not distinct resonances, and symmetry, solvent, multiplicity, and intensity are not predicted. Count is the number of matched carbon atoms.",
        bool(peaks),
    )


def uv_vis_spectrum(mol: Chem.Mol) -> dict:
    problematic = any(
        atom.GetFormalCharge() != 0 or atom.GetSymbol() in TRANSITION_METALS
        for atom in mol.GetAtoms()
    )
    conjugated = sum(1 for bond in mol.GetBonds() if bond.GetIsConjugated() or bond.GetIsAromatic())
    aromatic_rings = sum(
        1
        for ring in mol.GetRingInfo().BondRings()
        if ring and all(mol.GetBondWithIdx(index).GetIsAromatic() for index in ring)
    )
    if problematic or (conjugated < 2 and aromatic_rings == 0):
        reason = (
            "No estimate: charged or transition-metal chromophores require an electronic-structure method."
            if problematic
            else "No estimate: no supported conjugated pi chromophore was identified."
        )
        return _spectrum("UV-Vis", "UV–Vis conceptual region", "nm", 190, 800, [], reason, False)

    if conjugated >= 5 or aromatic_rings >= 2:
        low, high, label = 220.0, 450.0, "extended conjugated/aromatic chromophore (conceptual region)"
    else:
        low, high, label = 200.0, 350.0, "conjugated/aromatic chromophore (conceptual region)"
    return _spectrum(
        "UV-Vis",
        "UV–Vis conceptual region",
        "nm",
        190,
        800,
        [_peak(low, high, 0.5, label)],
        "Conceptual conjugation region only; this band is not a calculated λmax or absorbance. Substitution, solvent, protonation, and electronic structure can shift real spectra substantially.",
        True,
    )


def educational_spectra(mol: Chem.Mol, mol_h: Chem.Mol) -> list[dict]:
    return [ir_spectrum(mol), proton_nmr(mol_h), carbon_nmr(mol), uv_vis_spectrum(mol)]
