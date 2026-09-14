"""Conservative carbonyl environments shared by educational spectrum rules."""

from rdkit import Chem


def has_carbonyl(atom: Chem.Atom) -> bool:
    return atom.GetSymbol() == "C" and any(
        bond.GetBondTypeAsDouble() == 2 and bond.GetOtherAtom(atom).GetSymbol() == "O"
        for bond in atom.GetBonds()
    )


def carbonyl_kind(atom: Chem.Atom) -> str | None:
    """Neutral C(=O) with explicit substituents; ketones require two carbons.

    Hydrogens may be implicit or explicit. CO2 and unsupported derivatives
    abstain rather than falling through to a generic ketone range.
    """
    if atom.GetSymbol() != "C" or atom.GetFormalCharge() or atom.GetIsAromatic() or atom.GetNumRadicalElectrons():
        return None
    double_oxygens, singles = [], []
    for bond in atom.GetBonds():
        neighbor = bond.GetOtherAtom(atom)
        if bond.GetBondTypeAsDouble() == 2 and neighbor.GetSymbol() == "O" and neighbor.GetFormalCharge() == 0:
            double_oxygens.append(neighbor)
        elif bond.GetBondTypeAsDouble() == 1:
            if neighbor.GetAtomicNum() != 1:
                singles.append(neighbor)
        else:
            return None
    hydrogens = atom.GetTotalNumHs(includeNeighbors=True)
    if len(double_oxygens) != 1 or len(singles) + hydrogens != 2:
        return None
    if any(n.GetFormalCharge() or n.GetNumRadicalElectrons() for n in singles):
        return None
    carbons = [n for n in singles if n.GetSymbol() == "C"]
    hetero = [n for n in singles if n.GetSymbol() != "C"]
    if not hetero:
        if len(carbons) == 2 and hydrogens == 0:
            return "ketone"
        if hydrogens in (1, 2):
            return "aldehyde"
    if len(hetero) != 1 or len(carbons) + hydrogens != 1:
        return None
    neighbor = hetero[0]
    if neighbor.GetSymbol() == "N" and not neighbor.GetIsAromatic() and neighbor.GetTotalValence() == 3:
        return "amide"
    if neighbor.GetSymbol() == "O" and not neighbor.GetIsAromatic() and neighbor.GetTotalValence() == 2:
        if neighbor.GetTotalNumHs(includeNeighbors=True) == 1:
            return "acid"
        others = [n for n in neighbor.GetNeighbors() if n.GetIdx() != atom.GetIdx()]
        if len(others) == 1 and others[0].GetSymbol() == "C" and not has_carbonyl(others[0]):
            return "ester"
    return None
