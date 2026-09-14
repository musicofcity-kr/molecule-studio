"""RDKit-backed molecule construction with strict anonymous-endpoint bounds."""

from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

from rdkit import Chem
from rdkit.Chem import AllChem, Crippen, Descriptors, Lipinski, rdDepictor, rdMolDescriptors

from .native import load_drawing_libraries

load_drawing_libraries()
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit import rdBase

from .spectra import educational_spectra
from .vsepr import classify_vsepr
from .education import geometry_reference, hydrogen_bonding


MAX_BODY_BYTES = 64 * 1024
MAX_INPUT_CHARS = 50_000
MAX_SMILES_CHARS = 2_048
MAX_GRAPH_ATOMS = 96
MAX_GRAPH_BONDS = 192
MAX_TOTAL_ATOMS = 256
MAX_NAME_CHARS = 80
MAX_ABS_COORDINATE = 10_000.0
EMBED_SEED = 0x5EED


SOURCES = [
    {
        "title": "RDKit: Getting Started with the RDKit in Python",
        "url": "https://www.rdkit.org/docs/GettingStartedInPython.html",
    },
    {
        "title": "RDKit: Distance geometry API",
        "url": "https://www.rdkit.org/docs/source/rdkit.Chem.rdDistGeom.html",
    },
    {
        "title": "OpenStax Chemistry: Molecular Structure and Polarity",
        "url": "https://openstax.org/books/chemistry-atoms-first-2e/pages/4-6-molecular-structure-and-polarity",
    },
    {
        "title": "Chemistry LibreTexts: Infrared Spectroscopy Absorption Table",
        "url": "https://chem.libretexts.org/Ancillary_Materials/Reference/Reference_Tables/Spectroscopic_Reference_Tables/Infrared_Spectroscopy_Absorption_Table",
    },
    {
        "title": "Chemistry LibreTexts: Carbon-13 NMR",
        "url": "https://chem.libretexts.org/Bookshelves/Analytical_Chemistry/Instrumental_Analysis_%28LibreTexts%29/19%3A_Nuclear_Magnetic_Resonance_Spectroscopy/19.05%3A_Carbon-13_NMR",
    },
    {
        "title": "Chemistry LibreTexts: Ultraviolet Spectroscopy of Conjugated Systems",
        "url": "https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Organic_Chemistry_II_%28Morsch_et_al.%29/14%3A_Conjugated_Compounds_and_Ultraviolet_Spectroscopy/14.07%3A_Structure_Determination_in_Conjugated_Systems_-_Ultraviolet_Spectroscopy",
    },
]


class MoleculeInputError(ValueError):
    """A client-correctable input or bounded-computation error."""

    def __init__(self, code: str, message: str, status: int = 400):
        if not re.search("[가-힣]", message):
            message = {
                "invalid_smiles": "SMILES를 해석하지 못했습니다. 원소 기호, 괄호, 고리 번호와 결합 표기를 확인해 주세요.",
                "invalid_molblock": "MOL 파일의 원자·결합 표기를 읽지 못했습니다. 올바른 MOL 파일인지 확인해 주세요.",
                "invalid_graph": "그린 구조의 원자, 결합 수 또는 전하를 확인해 주세요.",
                "invalid_molecule": "구조의 원자가 또는 방향족 결합을 확인해 주세요.",
                "invalid_input": "SMILES, MOL 파일 또는 그린 구조 중 하나를 입력해 주세요.",
                "invalid_json": "입력 형식이 올바르지 않습니다. 구조를 다시 입력해 주세요.",
                "input_too_large": "입력이 허용 크기를 초과했습니다. 더 작은 구조나 파일로 시도해 주세요.",
                "molecule_too_large": "원자 또는 결합 수가 지원 한도를 초과했습니다. 더 작은 분자를 사용해 주세요.",
                "multiple_fragments": "하나로 연결된 분자를 입력해 주세요. 점으로 분리한 혼합물·염은 지원하지 않습니다.",
                "unsupported_molecule": "가상 원자, 질의 원자 또는 비공유 결합은 지원하지 않습니다. 원소와 공유 결합을 명시해 주세요.",
                "geometry_failed": "제한 시간 안에 3D 구조를 만들지 못했습니다. 더 단순한 구조로 시도해 주세요.",
            }.get(code, "분석하지 못했습니다. 입력 구조를 확인하고 다시 시도해 주세요.")
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def sanitize_name(value: Any, fallback: str = "Molecule") -> str:
    if not isinstance(value, str):
        return fallback
    value = unicodedata.normalize("NFKC", value)
    value = "".join(" " if ch.isspace() else ch for ch in value if unicodedata.category(ch)[0] != "C")
    value = re.sub(r"[<>&\"']", "", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return (value[:MAX_NAME_CHARS].rstrip() or fallback)


def _input_text(value: Any, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise MoleculeInputError("invalid_input", f"{label} must be a non-empty string.")
    if len(value) > maximum:
        raise MoleculeInputError("input_too_large", f"{label} exceeds the {maximum}-character limit.", 413)
    return value


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise MoleculeInputError("invalid_graph", f"{label} must be a finite number.")
    number = float(value)
    if not math.isfinite(number) or abs(number) > MAX_ABS_COORDINATE:
        raise MoleculeInputError(
            "invalid_graph",
            f"{label} must be finite and within ±{int(MAX_ABS_COORDINATE)}.",
        )
    return number


def _molecule_from_graph(graph: Any) -> Chem.Mol:
    if not isinstance(graph, dict):
        raise MoleculeInputError("invalid_graph", "graph must be an object containing atoms and bonds arrays.")
    atoms = graph.get("atoms")
    bonds = graph.get("bonds")
    if not isinstance(atoms, list) or not atoms:
        raise MoleculeInputError("invalid_graph", "graph.atoms must be a non-empty array.")
    if not isinstance(bonds, list):
        raise MoleculeInputError("invalid_graph", "graph.bonds must be an array.")
    if len(atoms) > MAX_GRAPH_ATOMS:
        raise MoleculeInputError(
            "molecule_too_large",
            f"graph has {len(atoms)} atoms; the limit is {MAX_GRAPH_ATOMS}.",
            413,
        )
    if len(bonds) > MAX_GRAPH_BONDS:
        raise MoleculeInputError(
            "molecule_too_large",
            f"graph has {len(bonds)} bonds; the limit is {MAX_GRAPH_BONDS}.",
            413,
        )

    editable = Chem.RWMol()
    id_to_index: dict[int, int] = {}
    aromatic_indices: set[int] = set()
    periodic_table = Chem.GetPeriodicTable()
    for position, item in enumerate(atoms):
        if not isinstance(item, dict):
            raise MoleculeInputError("invalid_graph", f"graph.atoms[{position}] must be an object.")
        atom_id = item.get("id")
        if type(atom_id) is not int or atom_id in id_to_index:
            raise MoleculeInputError("invalid_graph", "Atom ids must be unique integers.")
        element = item.get("element")
        if not isinstance(element, str):
            raise MoleculeInputError("invalid_graph", f"Atom {atom_id} has no valid element symbol.")
        element = element.strip()
        try:
            atomic_number = periodic_table.GetAtomicNumber(element)
        except RuntimeError:
            atomic_number = 0
        if atomic_number <= 0:
            raise MoleculeInputError("invalid_graph", f"Atom {atom_id} uses unknown element {element!r}.")
        _finite_number(item.get("x"), f"Atom {atom_id} x")
        _finite_number(item.get("y"), f"Atom {atom_id} y")
        charge = item.get("charge", 0)
        if type(charge) is not int or not -4 <= charge <= 4:
            raise MoleculeInputError("invalid_graph", f"Atom {atom_id} charge must be an integer from -4 to 4.")
        atom = Chem.Atom(atomic_number)
        atom.SetFormalCharge(charge)
        id_to_index[atom_id] = editable.AddAtom(atom)

    order_types = {
        1.0: Chem.BondType.SINGLE,
        1.5: Chem.BondType.AROMATIC,
        2.0: Chem.BondType.DOUBLE,
        3.0: Chem.BondType.TRIPLE,
    }
    seen_bonds: set[tuple[int, int]] = set()
    for position, item in enumerate(bonds):
        if not isinstance(item, dict):
            raise MoleculeInputError("invalid_graph", f"graph.bonds[{position}] must be an object.")
        a, b = item.get("a"), item.get("b")
        if type(a) is not int or type(b) is not int or a not in id_to_index or b not in id_to_index:
            raise MoleculeInputError("invalid_graph", f"Bond {position} references an unknown atom id.")
        if a == b:
            raise MoleculeInputError("invalid_graph", f"Bond {position} cannot join an atom to itself.")
        key = tuple(sorted((a, b)))
        if key in seen_bonds:
            raise MoleculeInputError("invalid_graph", f"Bond {position} duplicates an existing bond.")
        seen_bonds.add(key)
        raw_order = item.get("order")
        if isinstance(raw_order, bool) or not isinstance(raw_order, (int, float)):
            raise MoleculeInputError("invalid_graph", f"Bond {position} order must be 1, 1.5, 2, or 3.")
        order = float(raw_order)
        bond_type = order_types.get(order)
        if bond_type is None:
            raise MoleculeInputError("invalid_graph", f"Bond {position} order must be 1, 1.5, 2, or 3.")
        ai, bi = id_to_index[a], id_to_index[b]
        editable.AddBond(ai, bi, bond_type)
        if order == 1.5:
            aromatic_indices.update((ai, bi))

    for index in aromatic_indices:
        editable.GetAtomWithIdx(index).SetIsAromatic(True)
    molecule = editable.GetMol()
    try:
        Chem.SanitizeMol(molecule)
    except Exception as exc:
        raise MoleculeInputError("invalid_graph", f"Graph valence or aromaticity is invalid: {exc}") from None
    return molecule


def _parse_request(payload: Any) -> tuple[Chem.Mol, str]:
    if not isinstance(payload, dict):
        raise MoleculeInputError("invalid_json", "Request body must be a JSON object.")
    choices = [key for key in ("smiles", "molblock", "graph") if payload.get(key) is not None]
    if len(choices) != 1:
        raise MoleculeInputError("invalid_input", "Provide exactly one of smiles, molblock, or graph.")

    with rdBase.BlockLogs():
        if choices[0] == "smiles":
            source = _input_text(payload["smiles"], "smiles", MAX_SMILES_CHARS)
            molecule = Chem.MolFromSmiles(source, sanitize=False)
            if molecule is None:
                raise MoleculeInputError("invalid_smiles", "SMILES could not be parsed or sanitized.")
            problems = Chem.DetectChemistryProblems(molecule)
            valence = next((p for p in problems if p.GetType() == "AtomValenceException"), None)
            if valence is not None:
                raise MoleculeInputError("invalid_valence", f"원자 ID {valence.GetAtomIdx()}의 허용 결합 수(원자가)를 초과했습니다. 해당 원자의 결합 차수와 전하를 확인해 주세요.")
            try:
                Chem.SanitizeMol(molecule)
            except Exception:
                raise MoleculeInputError("invalid_smiles", "SMILES의 결합 또는 방향족 표기를 확인해 주세요. 현재 입력을 유효한 분자로 처리하지 못했습니다.") from None
        elif choices[0] == "molblock":
            source = _input_text(payload["molblock"], "molblock", MAX_INPUT_CHARS)
            molecule = Chem.MolFromMolBlock(source, sanitize=True, removeHs=False, strictParsing=True)
            if molecule is None:
                raise MoleculeInputError("invalid_molblock", "Mol block could not be parsed or sanitized.")
        else:
            molecule = _molecule_from_graph(payload["graph"])

    fallback_name = molecule.GetProp("_Name") if molecule.HasProp("_Name") else "Molecule"
    name = sanitize_name(payload.get("name"), sanitize_name(fallback_name))
    return molecule, name


def _bounded_normalize(molecule: Chem.Mol) -> Chem.Mol:
    if molecule.GetNumAtoms() > MAX_TOTAL_ATOMS:
        raise MoleculeInputError(
            "molecule_too_large",
            f"Input has {molecule.GetNumAtoms()} explicit atoms; the limit is {MAX_TOTAL_ATOMS}.",
            413,
        )
    if len(Chem.GetMolFrags(molecule)) != 1:
        raise MoleculeInputError(
            "multiple_fragments",
            "Provide one connected molecule; salts and dot-disconnected mixtures are not modeled by this endpoint.",
        )
    try:
        base = Chem.RemoveHs(Chem.Mol(molecule), sanitize=True)
        Chem.SanitizeMol(base)
    except Exception as exc:
        raise MoleculeInputError("invalid_molecule", f"Molecule sanitization failed: {exc}") from None
    if any(atom.GetAtomicNum() <= 0 or atom.HasQuery() for atom in base.GetAtoms()):
        raise MoleculeInputError(
            "unsupported_molecule",
            "Dummy atoms and query atoms are not supported; provide a fully specified molecule.",
            422,
        )
    supported_bonds = {
        Chem.BondType.SINGLE,
        Chem.BondType.DOUBLE,
        Chem.BondType.TRIPLE,
        Chem.BondType.AROMATIC,
    }
    if any(bond.HasQuery() or bond.GetBondType() not in supported_bonds for bond in base.GetBonds()):
        raise MoleculeInputError(
            "unsupported_molecule",
            "Query, dative, zero-order, and other non-covalent bond types are not supported.",
            422,
        )
    if base.GetNumHeavyAtoms() > MAX_GRAPH_ATOMS:
        raise MoleculeInputError(
            "molecule_too_large",
            f"Molecule has {base.GetNumHeavyAtoms()} heavy atoms; the limit is {MAX_GRAPH_ATOMS}.",
            413,
        )
    if base.GetNumBonds() > MAX_GRAPH_BONDS:
        raise MoleculeInputError(
            "molecule_too_large",
            f"Molecule has {base.GetNumBonds()} bonds; the limit is {MAX_GRAPH_BONDS}.",
            413,
        )
    return base


def _embed(base: Chem.Mol) -> tuple[Chem.Mol, str, list[str]]:
    molecule = Chem.AddHs(Chem.Mol(base))
    if molecule.GetNumAtoms() > MAX_TOTAL_ATOMS:
        raise MoleculeInputError(
            "molecule_too_large",
            f"Molecule has {molecule.GetNumAtoms()} atoms after adding hydrogens; the limit is {MAX_TOTAL_ATOMS}.",
            413,
        )
    molecule.RemoveAllConformers()
    parameters = AllChem.ETKDGv3()
    parameters.randomSeed = EMBED_SEED
    parameters.maxIterations = 200
    parameters.numThreads = 1
    parameters.useSmallRingTorsions = True
    if hasattr(parameters, "timeout"):
        parameters.timeout = 10
    result = AllChem.EmbedMolecule(molecule, parameters)
    if result != 0:
        raise MoleculeInputError(
            "geometry_failed",
            "RDKit ETKDGv3 could not generate a conformer within the bounded settings.",
            422,
        )

    warnings = [
        "3D 좌표는 고정 시드로 생성한 하나의 모델 구조(Å)입니다. 실험 구조와 다르며 측정 도구는 현재 모델 좌표에서 거리·각도를 계산합니다.",
    ]
    if AllChem.MMFFHasAllMoleculeParams(molecule):
        status = AllChem.MMFFOptimizeMolecule(molecule, maxIters=300)
        method = "RDKit ETKDGv3 + MMFF94"
        if status != 0:
            warnings.append("MMFF94 반복 한도에 도달했습니다. 현재 모델은 에너지 최소화가 완전히 수렴하지 않았을 수 있습니다.")
    elif AllChem.UFFHasAllMoleculeParams(molecule):
        status = AllChem.UFFOptimizeMolecule(molecule, maxIters=300)
        method = "RDKit ETKDGv3 + UFF (대체 힘장)"
        warnings.append("MMFF94 매개변수가 부족해 지원 가능한 UFF 힘장을 사용했습니다.")
        if status != 0:
            warnings.append("UFF 반복 한도에 도달했습니다. 현재 모델은 에너지 최소화가 완전히 수렴하지 않았을 수 있습니다.")
    else:
        method = "RDKit ETKDGv3 (힘장 최소화 미적용)"
        warnings.append("MMFF94·UFF의 매개변수가 부족해 힘장 에너지 최소화를 적용하지 않았습니다.")
    return molecule, method, warnings


def _draw_2d(base: Chem.Mol, name: str) -> tuple[str, str]:
    depiction = Chem.Mol(base)
    depiction.RemoveAllConformers()
    depiction.SetProp("_Name", name)
    rdDepictor.Compute2DCoords(depiction)
    molblock = Chem.MolToMolBlock(depiction)
    drawer = rdMolDraw2D.MolDraw2DSVG(420, 300)
    options = drawer.drawOptions()
    options.addStereoAnnotation = True
    drawer.DrawMolecule(depiction)
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    return molblock, svg


def _serialize_atoms(molecule: Chem.Mol) -> list[dict]:
    conformer = molecule.GetConformer()
    atoms = []
    for atom in molecule.GetAtoms():
        position = conformer.GetAtomPosition(atom.GetIdx())
        atoms.append({
            "id": atom.GetIdx(),
            "element": atom.GetSymbol(),
            "x": round(float(position.x), 6),
            "y": round(float(position.y), 6),
            "z": round(float(position.z), 6),
            "charge": atom.GetFormalCharge(),
            "hybridization": str(atom.GetHybridization()),
            "neighbors": sorted(neighbor.GetIdx() for neighbor in atom.GetNeighbors()),
        })
    return atoms


def _serialize_bonds(molecule: Chem.Mol) -> list[dict]:
    conformer = molecule.GetConformer()
    bonds = []
    for bond in molecule.GetBonds():
        a, b = bond.GetBeginAtomIdx(), bond.GetEndAtomIdx()
        first, second = conformer.GetAtomPosition(a), conformer.GetAtomPosition(b)
        length = math.dist((first.x, first.y, first.z), (second.x, second.y, second.z))
        bonds.append({
            "a": a,
            "b": b,
            "order": float(bond.GetBondTypeAsDouble()),
            "length": round(length, 6),
        })
    return bonds


def build_molecule(payload: Any) -> dict:
    """Build the exact Molecule JSON shape declared in ``src/types.ts``."""
    molecule, name = _parse_request(payload)
    base = _bounded_normalize(molecule)
    canonical_smiles = Chem.MolToSmiles(base, canonical=True, isomericSmiles=True)
    model, method, warnings = _embed(base)
    molblock, svg = _draw_2d(base, name)
    return {
        "analysisVersion": 2,
        "hydrogenBonding": hydrogen_bonding(base),
        "geometryReference": geometry_reference(base),
        "name": name,
        "smiles": canonical_smiles,
        "formula": rdMolDescriptors.CalcMolFormula(base),
        "molWeight": round(float(Descriptors.MolWt(base)), 4),
        "atoms": _serialize_atoms(model),
        "bonds": _serialize_bonds(model),
        "molblock": molblock,
        "svg": svg,
        "method": method,
        "warnings": warnings,
        "vsepr": classify_vsepr(model),
        "spectra": educational_spectra(base, model),
        "properties": {
            "hbd": int(Lipinski.NumHDonors(base)),
            "hba": int(Lipinski.NumHAcceptors(base)),
            "logP": round(float(Crippen.MolLogP(base)), 4),
            "tpsa": round(float(rdMolDescriptors.CalcTPSA(base)), 4),
        },
        "sources": list(SOURCES),
    }
