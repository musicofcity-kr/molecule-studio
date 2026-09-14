"""Descriptor provenance and molecule-specific reference data, not coordinates."""

from rdkit import Chem, rdBase

HBD_SOURCE = "https://raw.githubusercontent.com/rdkit/rdkit/Release_2026_03_6/Code/GraphMol/Descriptors/Lipinski.cpp"
WATER_SOURCE = "https://cccbdb.nist.gov/expgeom2x.asp?casno=7732185"


def is_water(base: Chem.Mol) -> bool:
    return Chem.MolToSmiles(base) == "O"


def hydrogen_bonding(base: Chem.Mol) -> dict:
    note = "수소 결합 주개·받개는 상호작용에서의 역할입니다. 아래 지표는 RDKit 규칙에 일치하는 부위 수이며, 동시에 형성하는 수소 결합 수나 가능한 역할 전체를 뜻하지 않습니다."
    if is_water(base):
        note = "물은 수소 결합의 주개와 받개 역할을 모두 할 수 있습니다. 이 RDKit 규칙은 수소 두 개가 붙은 물의 산소를 집계하지 않아 원시 지표가 0/0입니다. 수소 결합을 못 한다는 뜻이 아닙니다."
    return {
        "note": note,
        "definition": "NumHDonors → CalcNumHBD, NumHAcceptors → CalcNumHBA의 SMARTS 일치 부위 수입니다. 수소 원자 수·실제 결합 수·단순 N/O 원자 수와 다릅니다. 아마이드 질소는 받개로 집계하지 않습니다.",
        "hydrogenHandling": "Chem.RemoveHs로 정규화한 구조의 암시적 수소 정보를 사용합니다. 3D 구조는 별도로 Chem.AddHs로 수소를 추가합니다.",
        "library": f"RDKit {rdBase.rdkitVersion}",
        "functions": "Lipinski.NumHDonors / Lipinski.NumHAcceptors",
        "source": HBD_SOURCE,
    }


def geometry_reference(base: Chem.Mol) -> dict | None:
    if not is_water(base):
        return None
    return {"title": "기체상 H₂O 평형 구조 참고값", "angle": 104.4776, "length": 0.958,
            "angleUnit": "°", "lengthUnit": "Å", "source": "NIST CCCBDB · Hoy/Bunker (1979)",
            "url": WATER_SOURCE,
            "notice": "외부 자료의 평형 구조입니다. 현재 ETKDG·힘장 모델의 측정값을 이 값에 맞춰 보정하지 않습니다."}
