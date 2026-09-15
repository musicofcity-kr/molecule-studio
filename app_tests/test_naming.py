from __future__ import annotations

import json
import unittest
from urllib.error import HTTPError

from chemistry import MoleculeInputError
from chemistry.naming import PUG_REST_URL, RESPONSE_LIMIT, lookup_name, reset_name_cache
from chemistry.model import MAX_GRAPH_ATOMS


class FakeResponse:
    def __init__(self, value: object) -> None:
        self.value = json.dumps(value).encode("utf-8")
        self.closed = False

    def read(self, _limit: int) -> bytes:
        return self.value

    def close(self) -> None:
        self.closed = True


class RawResponse(FakeResponse):
    def __init__(self, value: bytes) -> None:
        self.value = value
        self.closed = False


class NamingLookupTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_name_cache()

    def test_verified_stereo_name_uses_form_post_and_cache(self) -> None:
        calls = []
        def opener(request, timeout):
            calls.append((request, timeout))
            return FakeResponse({"PropertyTable": {"Properties": [{
                "CID": 702, "IUPACName": "ethanol", "SMILES": "CCO",
            }]}})
        first = lookup_name({"smiles": "OCC"}, opener=opener)
        second = lookup_name({"smiles": "CCO"}, opener=opener)
        self.assertEqual(first["status"], "available")
        self.assertEqual(first["smiles"], "CCO")
        self.assertEqual(first["iupacName"], "ethanol")
        self.assertEqual(first["commonName"], "에탄올")
        self.assertEqual(first["sourceUrl"], "https://pubchem.ncbi.nlm.nih.gov/compound/702")
        self.assertEqual(second, first)
        self.assertEqual(len(calls), 1)
        request, timeout = calls[0]
        self.assertEqual(request.full_url, PUG_REST_URL)
        self.assertEqual(request.get_method(), "POST")
        self.assertGreater(timeout, 0)
        self.assertLessEqual(timeout, 5)
        self.assertIn(b"smiles=CCO", request.data)

    def test_stereo_or_structure_mismatch_is_not_used(self) -> None:
        def opener(_request, timeout):
            return FakeResponse({"PropertyTable": {"Properties": [{
                "CID": 1, "IUPACName": "wrong stereoisomer", "SMILES": "C[C@@H](O)F",
            }]}})
        result = lookup_name({"smiles": "C[C@H](O)F"}, opener=opener)
        self.assertEqual(result["status"], "unavailable")
        self.assertIsNone(result["iupacName"])
        self.assertIsNone(result["source"])

    def test_actual_pubchem_smiles_key_preserves_same_stereoisomer_only(self) -> None:
        # Mocked from the 2026-09-15 direct PUG-REST probe: equivalent SMILES
        # spelling retains the same (2S) structure and may receive its IUPAC name.
        def matching(_request, timeout):
            return FakeResponse({"PropertyTable": {"Properties": [{
                "CID": 107689, "SMILES": "C[C@@H](C(=O)O)O",
                "IUPACName": "(2S)-2-hydroxypropanoic acid",
            }]}})
        result = lookup_name({"smiles": "C[C@H](O)C(=O)O"}, opener=matching)
        self.assertEqual(result["status"], "available")
        reset_name_cache()
        def opposite(_request, timeout):
            return FakeResponse({"PropertyTable": {"Properties": [{
                "CID": 107689, "SMILES": "C[C@H](C(=O)O)O",
                "IUPACName": "wrong enantiomer name",
            }]}})
        rejected = lookup_name({"smiles": "C[C@H](O)C(=O)O"}, opener=opposite)
        self.assertEqual(rejected["status"], "unavailable")
        self.assertIsNone(rejected["iupacName"])

    def test_not_found_and_network_failure_are_nonfatal_lookup_statuses(self) -> None:
        def not_found(request, timeout):
            raise HTTPError(request.full_url, 404, "not found", None, None)
        result = lookup_name({"smiles": "N"}, opener=not_found)
        self.assertEqual(result["status"], "not_found")
        reset_name_cache()
        def offline(_request, timeout):
            raise TimeoutError()
        result = lookup_name({"smiles": "N"}, opener=offline)
        self.assertEqual(result["status"], "unavailable")

    def test_unavailable_result_is_not_cached_and_recovers_on_retry(self) -> None:
        calls = 0
        def opener(_request, timeout):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise TimeoutError()
            return FakeResponse({"PropertyTable": {"Properties": [{
                "CID": 962, "SMILES": "O", "IUPACName": "oxidane",
            }]}})
        self.assertEqual(lookup_name({"smiles": "O"}, opener=opener)["status"], "unavailable")
        recovered = lookup_name({"smiles": "O"}, opener=opener)
        self.assertEqual(calls, 2)
        self.assertEqual(recovered["status"], "available")

    def test_malformed_and_oversized_provider_responses_are_unavailable(self) -> None:
        def response_for(value):
            return lambda _request, timeout: FakeResponse(value)
        for value in (
            {"PropertyTable": None},
            {"PropertyTable": []},
            {"PropertyTable": {"Properties": [{"CID": True, "SMILES": "O", "IUPACName": "oxidane"}]}},
            {"PropertyTable": {"Properties": [{"CID": 0, "SMILES": "O", "IUPACName": "oxidane"}]}},
        ):
            self.assertEqual(lookup_name({"smiles": "O"}, opener=response_for(value))["status"], "unavailable")
        self.assertEqual(lookup_name({"smiles": "O"}, opener=lambda _request, timeout: RawResponse(b"{"))["status"], "unavailable")
        self.assertEqual(lookup_name({"smiles": "O"}, opener=lambda _request, timeout: RawResponse(b"x" * (RESPONSE_LIMIT + 1)))["status"], "unavailable")

    def test_input_boundary_uses_existing_error_type(self) -> None:
        for payload in ({}, {"smiles": "O", "name": "water"}, {"smiles": "not a smiles"}):
            with self.assertRaises(MoleculeInputError) as caught:
                lookup_name(payload, opener=lambda *_args, **_kwargs: None)
            self.assertEqual(caught.exception.status, 400)

    def test_existing_atom_limit_applies_before_network_lookup(self) -> None:
        calls = 0
        def opener(_request, timeout):
            nonlocal calls
            calls += 1
            return FakeResponse({})
        with self.assertRaises(MoleculeInputError) as caught:
            lookup_name({"smiles": "C" * (MAX_GRAPH_ATOMS + 1)}, opener=opener)
        self.assertEqual(caught.exception.code, "molecule_too_large")
        self.assertEqual(calls, 0)


if __name__ == "__main__":
    unittest.main()
