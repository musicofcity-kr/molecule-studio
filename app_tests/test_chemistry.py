from __future__ import annotations

import math
import unittest

from rdkit import Chem

from chemistry import MAX_GRAPH_ATOMS, MoleculeInputError, build_molecule
from chemistry.vsepr import classify_vsepr


MOLECULE_KEYS = {
    "name", "smiles", "formula", "molWeight", "atoms", "bonds", "molblock",
    "svg", "method", "warnings", "vsepr", "spectra", "properties", "sources",
    "analysisVersion", "hydrogenBonding", "geometryReference",
}


def angle_degrees(first: dict, center: dict, third: dict) -> float:
    a = tuple(first[key] - center[key] for key in ("x", "y", "z"))
    b = tuple(third[key] - center[key] for key in ("x", "y", "z"))
    dot = sum(x * y for x, y in zip(a, b))
    denominator = math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return math.degrees(math.acos(max(-1.0, min(1.0, dot / denominator))))


class MoleculeConstructionTests(unittest.TestCase):
    def test_exact_schema_explicit_hydrogens_and_2d_exports(self) -> None:
        result = build_molecule({"smiles": "CCO", "name": "ethanol"})
        self.assertEqual(set(result), MOLECULE_KEYS)
        self.assertEqual(result["formula"], "C2H6O")
        self.assertEqual(len(result["atoms"]), 9)
        self.assertEqual(sum(atom["element"] == "H" for atom in result["atoms"]), 6)
        self.assertTrue(result["svg"].lstrip().startswith("<?xml") or "<svg" in result["svg"][:300])
        self.assertIn("2D", result["molblock"].splitlines()[1])
        self.assertEqual(set(result["properties"]), {"hbd", "hba", "logP", "tpsa"})
        for atom in result["atoms"]:
            self.assertEqual(set(atom), {"id", "element", "x", "y", "z", "charge", "hybridization", "neighbors"})
        for bond in result["bonds"]:
            self.assertEqual(set(bond), {"a", "b", "order", "length"})
            self.assertGreater(bond["length"], 0.65)
            self.assertLess(bond["length"], 2.2)

    def test_deterministic_etkdg_coordinates(self) -> None:
        first = build_molecule({"smiles": "CC(=O)O"})
        second = build_molecule({"smiles": "CC(=O)O"})
        coords1 = [(atom["x"], atom["y"], atom["z"]) for atom in first["atoms"]]
        coords2 = [(atom["x"], atom["y"], atom["z"]) for atom in second["atoms"]]
        self.assertEqual(coords1, coords2)
        self.assertIn("ETKDGv3", first["method"])

    def test_water_distance_angle_and_vsepr(self) -> None:
        result = build_molecule({"smiles": "O", "name": "water"})
        oxygen = next(atom for atom in result["atoms"] if atom["element"] == "O")
        hydrogens = [result["atoms"][index] for index in oxygen["neighbors"]]
        self.assertEqual(len(hydrogens), 2)
        self.assertTrue(all(atom["element"] == "H" for atom in hydrogens))
        oh_lengths = [
            math.dist((oxygen["x"], oxygen["y"], oxygen["z"]), (h["x"], h["y"], h["z"]))
            for h in hydrogens
        ]
        self.assertTrue(all(0.85 < length < 1.15 for length in oh_lengths))
        self.assertGreater(angle_degrees(hydrogens[0], oxygen, hydrogens[1]), 95)
        self.assertLess(angle_degrees(hydrogens[0], oxygen, hydrogens[1]), 115)
        vsepr = next(item for item in result["vsepr"] if item["atomId"] == oxygen["id"])
        self.assertEqual(vsepr["notation"], "AX2E2")
        self.assertEqual(vsepr["shape"], "bent")
        self.assertTrue(vsepr["supported"])
        ir = next(item for item in result["spectra"] if item["kind"] == "IR")
        self.assertTrue(ir["supported"])
        self.assertIn("O-H", " ".join(peak["label"] for peak in ir["peaks"]))

    def test_ammonia_and_carbonyl_classification(self) -> None:
        ammonia = build_molecule({"smiles": "N"})
        nitrogen = next(item for item in ammonia["vsepr"] if ammonia["atoms"][item["atomId"]]["element"] == "N")
        self.assertEqual(nitrogen["notation"], "AX3E")
        self.assertEqual(nitrogen["shape"], "trigonal pyramidal")
        ammonia_ir = next(item for item in ammonia["spectra"] if item["kind"] == "IR")
        self.assertTrue(ammonia_ir["supported"])
        self.assertIn("N-H", " ".join(peak["label"] for peak in ammonia_ir["peaks"]))

        acetone = build_molecule({"smiles": "CC(=O)C"})
        carbonyl_carbon_id = next(
            bond["a"] if acetone["atoms"][bond["a"]]["element"] == "C" else bond["b"]
            for bond in acetone["bonds"]
            if bond["order"] == 2.0
            and {acetone["atoms"][bond["a"]]["element"], acetone["atoms"][bond["b"]]["element"]} == {"C", "O"}
        )
        carbonyl_vsepr = next(item for item in acetone["vsepr"] if item["atomId"] == carbonyl_carbon_id)
        self.assertEqual(carbonyl_vsepr["notation"], "AX3")
        self.assertEqual(carbonyl_vsepr["shape"], "trigonal planar")

    def test_graph_input_and_name_sanitization(self) -> None:
        result = build_molecule({
            "name": " <script>\r\nEthanol & demo </script> ",
            "graph": {
                "atoms": [
                    {"id": 10, "element": "C", "x": 0, "y": 0},
                    {"id": 20, "element": "C", "x": 1.5, "y": 0},
                    {"id": 30, "element": "O", "x": 3, "y": 0},
                ],
                "bonds": [
                    {"a": 10, "b": 20, "order": 1},
                    {"a": 20, "b": 30, "order": 1},
                ],
            },
        })
        self.assertEqual(result["smiles"], "CCO")
        self.assertNotIn("<", result["name"])
        self.assertNotIn("\n", result["name"])
        self.assertEqual(result["molblock"].splitlines()[0], result["name"])

    def test_molblock_input(self) -> None:
        source = Chem.MolToMolBlock(Chem.MolFromSmiles("CO"))
        result = build_molecule({"molblock": source, "name": "methanol"})
        self.assertEqual(result["smiles"], "CO")
        self.assertEqual(result["formula"], "CH4O")


class SpectrumTests(unittest.TestCase):
    def test_spectrum_ranges_stay_inside_axes(self) -> None:
        result = build_molecule({"smiles": "CC(=O)Oc1ccccc1"})
        self.assertEqual([item["kind"] for item in result["spectra"]], ["IR", "1H NMR", "13C NMR", "UV-Vis"])
        for spectrum in result["spectra"]:
            for peak in spectrum["peaks"]:
                self.assertLessEqual(spectrum["xMin"], peak["range"][0])
                self.assertLess(peak["range"][0], peak["range"][1])
                self.assertLessEqual(peak["range"][1], spectrum["xMax"])
                self.assertNotIn("position", peak)
                self.assertNotIn("intensity", peak)
                self.assertNotIn("count", peak)
        ir_labels = " ".join(peak["label"] for peak in result["spectra"][0]["peaks"])
        self.assertIn("에스터 C=O", ir_labels)

    def test_uv_vis_abstains_without_supported_chromophore(self) -> None:
        ethanol = build_molecule({"smiles": "CCO"})
        uv = next(item for item in ethanol["spectra"] if item["kind"] == "UV-Vis")
        self.assertFalse(uv["supported"])
        self.assertEqual(uv["peaks"], [])
        self.assertEqual(uv["status"], "unprovided")

        benzene = build_molecule({"smiles": "c1ccccc1"})
        uv = next(item for item in benzene["spectra"] if item["kind"] == "UV-Vis")
        self.assertTrue(uv["supported"])
        self.assertTrue(uv["peaks"])
        self.assertIn("개념도", uv["notice"])


class InputBoundaryTests(unittest.TestCase):
    def assert_error(self, payload: object, code: str) -> MoleculeInputError:
        with self.assertRaises(MoleculeInputError) as caught:
            build_molecule(payload)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_invalid_smiles_and_ambiguous_request(self) -> None:
        self.assert_error({"smiles": "C1(not-valid"}, "invalid_smiles")
        self.assert_error({}, "invalid_input")
        self.assert_error({"smiles": "O", "graph": {"atoms": [], "bonds": []}}, "invalid_input")

    def test_invalid_graph_references_valence_and_coordinates(self) -> None:
        self.assert_error({
            "graph": {
                "atoms": [{"id": 1, "element": "C", "x": 0, "y": 0}],
                "bonds": [{"a": 1, "b": 2, "order": 1}],
            }
        }, "invalid_graph")
        self.assert_error({
            "graph": {
                "atoms": [{"id": 1, "element": "C", "x": float("nan"), "y": 0}],
                "bonds": [],
            }
        }, "invalid_graph")
        self.assert_error({
            "graph": {
                "atoms": [
                    {"id": 1, "element": "C", "x": 0, "y": 0},
                    *({"id": index, "element": "F", "x": index, "y": 0} for index in range(2, 7)),
                ],
                "bonds": [{"a": 1, "b": index, "order": 1} for index in range(2, 7)],
            }
        }, "invalid_graph")

    def test_oversized_smiles_and_graph(self) -> None:
        error = self.assert_error({"smiles": "C" * 2049}, "input_too_large")
        self.assertEqual(error.status, 413)
        atoms = [{"id": index, "element": "C", "x": index, "y": 0} for index in range(MAX_GRAPH_ATOMS + 1)]
        error = self.assert_error({"graph": {"atoms": atoms, "bonds": []}}, "molecule_too_large")
        self.assertEqual(error.status, 413)

    def test_multiple_fragments_rejected(self) -> None:
        self.assert_error({"smiles": "CC.O"}, "multiple_fragments")

    def test_charged_and_transition_centers_explicitly_unsupported(self) -> None:
        charged = build_molecule({"smiles": "[NH4+]"})
        self.assertFalse(charged["vsepr"][0]["supported"])
        self.assertIn("형식 전하", charged["vsepr"][0]["explanation"])

        iron = Chem.AddHs(Chem.MolFromSmiles("[Fe]"))
        classification = classify_vsepr(iron)
        self.assertFalse(classification[0]["supported"])
        self.assertIn("전이 금속", classification[0]["explanation"])


if __name__ == "__main__":
    unittest.main()
