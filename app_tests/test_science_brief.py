"""Scientific regressions from the user's brief, independent of UI phrasing."""
import json
import math
import unittest
from rdkit import Chem, rdBase
from rdkit.Chem import Lipinski
from chemistry import build_molecule, MoleculeInputError
from chemistry.functional_groups import carbonyl_kind, has_carbonyl


class ScienceBriefTests(unittest.TestCase):
    def test_carbonyl_environments_are_exclusive_and_hydrogen_invariant(self):
        cases = [("O=C=O", None), ("CC(=O)C", "ketone"), ("CC=O", "aldehyde"),
                 ("CC(=O)O", "acid"), ("CC(=O)OC", "ester"), ("CC(=O)N", "amide"),
                 ("C=C=O", None), ("CC(=O)Cl", None), ("CC(=O)[O-]", None),
                 ("C=O", "aldehyde"), ("O=CO", "acid"), ("CC(=O)OC(C)=O", None)]
        for smiles, expected in cases:
            for mol in [Chem.MolFromSmiles(smiles), Chem.AddHs(Chem.MolFromSmiles(smiles))]:
                with self.subTest(smiles=smiles, explicit_h=mol.GetNumAtoms()):
                    centers = [a for a in mol.GetAtoms() if has_carbonyl(a)]
                    self.assertTrue(centers)
                    self.assertEqual({carbonyl_kind(a) for a in centers}, {expected})

    def test_carbonyl_ranges_and_ir_do_not_fall_back_to_ketone(self):
        names = {"CC(=O)C": "케톤", "CC=O": "알데하이드", "CC(=O)O": "카복실산", "CC(=O)OC": "에스터", "CC(=O)N": "아마이드"}
        for smiles, label in names.items():
            result = build_molecule({"smiles": smiles})
            carbon = next(s for s in result["spectra"] if s["kind"] == "13C NMR")
            carbonyl = [r for r in carbon["peaks"] if "카보닐" in r["label"]]
            self.assertEqual(len(carbonyl), 1)
            self.assertIn(label, carbonyl[0]["label"])
            if label != "케톤":
                self.assertNotIn("케톤", json.dumps(result["spectra"], ensure_ascii=False))
        for smiles in ["O=C=O", "C=C=O", "CC(=O)Cl"]:
            result = build_molecule({"smiles": smiles})
            data = json.dumps(result["spectra"], ensure_ascii=False)
            self.assertNotIn("케톤", data)
            self.assertNotIn("212.5", data)

    def test_missing_spectral_data_is_not_absence_of_absorption(self):
        co2 = {s["kind"]: s for s in build_molecule({"smiles": "O=C=O"})["spectra"]}
        for kind in ["IR", "13C NMR", "UV-Vis"]:
            self.assertEqual(co2[kind]["peaks"], [])
            self.assertEqual(co2[kind]["status"], "unsupported")
        self.assertEqual(co2["1H NMR"]["status"], "not_applicable")
        water = {s["kind"]: s for s in build_molecule({"smiles": "O"})["spectra"]}
        self.assertEqual(water["13C NMR"]["status"], "not_applicable")
        self.assertEqual(water["UV-Vis"]["status"], "unprovided")

    def test_hydrogen_bond_counts_preserve_library_definition(self):
        for smiles, expected in [("O", (0, 0)), ("[H]O[H]", (0, 0)), ("CCO", (1, 1)), ("COC", (0, 1)), ("CC(=O)N", (1, 1))]:
            result = build_molecule({"smiles": smiles})
            base = Chem.RemoveHs(Chem.MolFromSmiles(smiles))
            raw = (Lipinski.NumHDonors(base), Lipinski.NumHAcceptors(base))
            self.assertEqual((result["properties"]["hbd"], result["properties"]["hba"]), raw)
            self.assertEqual(raw, expected)
            self.assertIn(rdBase.rdkitVersion, result["hydrogenBonding"]["library"])
            self.assertIn("CalcNumHBA", result["hydrogenBonding"]["definition"])
            self.assertIn("Chem.RemoveHs", result["hydrogenBonding"]["hydrogenHandling"])
            if smiles in {"O", "[H]O[H]"}:
                self.assertIn("주개와 받개 역할을 모두", result["hydrogenBonding"]["note"])

    def test_geometry_references_do_not_override_coordinates_or_other_molecules(self):
        for smiles in ["O", "CCO", "COC", "CC(=O)N", "O=C=O"]:
            result = build_molecule({"smiles": smiles})
            for bond in result["bonds"]:
                first, second = result["atoms"][bond["a"]], result["atoms"][bond["b"]]
                actual = math.dist([first[k] for k in "xyz"], [second[k] for k in "xyz"])
                self.assertAlmostEqual(actual, bond["length"], delta=0.000002)
            for vsepr in result["vsepr"]:
                if vsepr["notation"] == "AX2E2":
                    self.assertEqual(vsepr["idealAngles"], "109.5°")
                if smiles == "CC(=O)N" and result["atoms"][vsepr["atomId"]]["element"] == "N":
                    self.assertFalse(vsepr["supported"])
                if smiles == "O=C=O" and result["atoms"][vsepr["atomId"]]["element"] == "C":
                    self.assertEqual((vsepr["notation"], vsepr["shape"], vsepr["idealAngles"]), ("AX2", "linear", "180°"))
            if smiles == "O":
                self.assertEqual(result["geometryReference"]["angle"], 104.4776)
                self.assertIn("NIST", result["geometryReference"]["source"])
            else:
                self.assertIsNone(result["geometryReference"])

    def test_invalid_valence_is_distinguished_from_unknown_parse_error(self):
        for smiles, expected in [("C(C)(C)(C)(C)C", "invalid_valence"), ("C1=", "invalid_smiles")]:
            with self.assertRaises(MoleculeInputError) as caught:
                build_molecule({"smiles": smiles})
            self.assertEqual(caught.exception.code, expected)
            self.assertRegex(caught.exception.message, "[가-힣]")


if __name__ == '__main__':
    unittest.main()
