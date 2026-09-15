"""Bounded, opt-in PubChem name lookup for an already specified SMILES string."""

from __future__ import annotations

from collections import OrderedDict, deque
import json
import threading
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from rdkit import Chem

from .model import MoleculeInputError, _bounded_normalize, _parse_request

PUG_REST_URL = (
    "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/fastidentity/smiles/"
    "property/IUPACName,IsomericSMILES/JSON?identity_type=same_stereo_isotope"
)
SOURCE = "PubChem"
RESPONSE_LIMIT = 256 * 1024
CACHE_TTL_SECONDS = 15 * 60
NOT_FOUND_TTL_SECONDS = 60
CACHE_MAX_ITEMS = 128
RATE_LIMIT = 5
LOOKUP_DEADLINE_SECONDS = 5.5

_cache: OrderedDict[str, tuple[float, dict[str, Any]]] = OrderedDict()
_request_times: deque[float] = deque()
_lock = threading.Lock()


def _empty(smiles: str, status: str, common_name: str | None = None) -> dict[str, Any]:
    return {
        "smiles": smiles, "status": status, "iupacName": None, "commonName": common_name,
        "source": None, "sourceUrl": None, "cid": None,
    }


def _canonical_smiles(value: Any) -> str:
    # Reuse the analysis endpoint's parser and bounded normalizer. This keeps
    # name lookup from accepting huge, disconnected, query, or unsupported
    # structures that the modeling API rejects.
    molecule, _ = _parse_request({"smiles": value})
    base = _bounded_normalize(molecule)
    return Chem.MolToSmiles(base, canonical=True, isomericSmiles=True)


def _canonical_known(smiles: str) -> str:
    molecule = Chem.MolFromSmiles(smiles)
    assert molecule is not None
    return Chem.MolToSmiles(molecule, canonical=True, isomericSmiles=True)


COMMON_NAMES = {
    _canonical_known("O"): "물",
    _canonical_known("CCO"): "에탄올",
    _canonical_known("Cn1cnc2c1c(=O)n(C)c(=O)n2C"): "카페인",
    _canonical_known("CC(=O)Oc1ccccc1C(=O)O"): "아스피린",
}


def _cache_get(smiles: str) -> dict[str, Any] | None:
    now = time.monotonic()
    with _lock:
        item = _cache.get(smiles)
        if item is None or item[0] <= now:
            _cache.pop(smiles, None)
            return None
        _cache.move_to_end(smiles)
        return dict(item[1])


def _cache_put(smiles: str, result: dict[str, Any], ttl_seconds: float) -> dict[str, Any]:
    with _lock:
        _cache[smiles] = (time.monotonic() + ttl_seconds, dict(result))
        _cache.move_to_end(smiles)
        while len(_cache) > CACHE_MAX_ITEMS:
            _cache.popitem(last=False)
    return result


def _throttle(deadline: float) -> bool:
    while True:
        with _lock:
            now = time.monotonic()
            while _request_times and now - _request_times[0] >= 1:
                _request_times.popleft()
            if len(_request_times) < RATE_LIMIT:
                _request_times.append(now)
                return True
            pause = max(0.001, 1 - (now - _request_times[0]))
            if now + pause >= deadline:
                return False
        time.sleep(pause)


def _response_value(response: Any) -> bytes:
    data = response.read(RESPONSE_LIMIT + 1)
    if len(data) > RESPONSE_LIMIT:
        raise ValueError("response too large")
    return data


def _verified_property(smiles: str, body: dict[str, Any]) -> tuple[str, int] | None:
    table = body.get("PropertyTable")
    if not isinstance(table, dict):
        return None
    properties = table.get("Properties")
    if not isinstance(properties, list) or len(properties) != 1 or not isinstance(properties[0], dict):
        return None
    property_value = properties[0]
    # PUG-REST currently returns its isomeric result under SMILES even when
    # IsomericSMILES is requested. Never fall back to connectivity-only
    # CanonicalSMILES: it could attach a name to the wrong stereoisomer.
    remote_smiles = property_value.get("IsomericSMILES", property_value.get("SMILES"))
    name = property_value.get("IUPACName")
    cid = property_value.get("CID")
    if not isinstance(remote_smiles, str) or not isinstance(name, str) or not name.strip() or len(name) > 512 or isinstance(cid, bool) or not isinstance(cid, int) or cid <= 0:
        return None
    try:
        if _canonical_smiles(remote_smiles) != smiles:
            return None
    except MoleculeInputError:
        return None
    return name.strip(), cid


def _source_url(cid: int) -> str:
    return f"https://pubchem.ncbi.nlm.nih.gov/compound/{cid}"


def lookup_name(payload: Any, *, opener: Callable[..., Any] = urlopen) -> dict[str, Any]:
    """Return a separately fetched, structure-verified IUPAC name when available."""
    if not isinstance(payload, dict):
        raise MoleculeInputError("invalid_json", "Request body must be a JSON object.")
    if set(payload) != {"smiles"}:
        raise MoleculeInputError("invalid_input", "Name lookup requires exactly one smiles field.")
    smiles = _canonical_smiles(payload["smiles"])
    cached = _cache_get(smiles)
    if cached is not None:
        return cached
    common_name = COMMON_NAMES.get(smiles)
    deadline = time.monotonic() + LOOKUP_DEADLINE_SECONDS
    if not _throttle(deadline):
        return _empty(smiles, "unavailable", common_name)
    request = Request(
        PUG_REST_URL,
        data=urlencode({"smiles": smiles}).encode("utf-8"),
        headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        remaining = max(0.1, min(5.0, deadline - time.monotonic()))
        response = opener(request, timeout=remaining)
        try:
            raw = _response_value(response)
        finally:
            close = getattr(response, "close", None)
            if callable(close):
                close()
        parsed = json.loads(raw.decode("utf-8"))
        if not isinstance(parsed, dict):
            raise ValueError("response is not an object")
        verified = _verified_property(smiles, parsed)
        if verified is None:
            result = _empty(smiles, "unavailable", common_name)
        else:
            iupac_name, cid = verified
            result = {
                "smiles": smiles, "status": "available", "iupacName": iupac_name,
                "commonName": common_name, "source": SOURCE, "sourceUrl": _source_url(cid), "cid": cid,
            }
    except HTTPError as exc:
        result = _empty(smiles, "not_found" if exc.code == 404 else "unavailable", common_name)
    except (URLError, OSError, TimeoutError, UnicodeDecodeError, json.JSONDecodeError, ValueError):
        result = _empty(smiles, "unavailable", common_name)
    if result["status"] == "available":
        return _cache_put(smiles, result, CACHE_TTL_SECONDS)
    if result["status"] == "not_found":
        return _cache_put(smiles, result, NOT_FOUND_TTL_SECONDS)
    return result


def reset_name_cache() -> None:
    """Test-only cache reset; keeps network state isolated between unit tests."""
    with _lock:
        _cache.clear()
        _request_times.clear()
