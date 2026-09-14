"""Vercel Python function and local server for molecular modelling."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
from urllib.parse import urlsplit


# Running ``python api/molecule.py`` places api/ rather than the project root on
# sys.path. Vercel already imports from the project root, so this is harmless.
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from rdkit import rdBase  # noqa: E402

from chemistry import MAX_BODY_BYTES, MAX_GRAPH_ATOMS, MoleculeInputError, build_molecule  # noqa: E402
from chemistry.model import MAX_GRAPH_BONDS, MAX_TOTAL_ATOMS  # noqa: E402


class handler(BaseHTTPRequestHandler):
    server_version = "MoleculeAPI/1.0"

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def _path(self) -> str:
        return urlsplit(self.path).path.rstrip("/") or "/"

    def do_OPTIONS(self) -> None:  # noqa: N802
        if self._path() != "/api/molecule":
            self._json(404, {"error": {"code": "not_found", "message": "Route not found."}})
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self._path() != "/api/molecule":
            self._json(404, {"error": {"code": "not_found", "message": "Route not found."}})
            return
        self._json(200, {
            "status": "ok",
            "service": "molecule",
            "rdkit": rdBase.rdkitVersion,
            "limits": {
                "bodyBytes": MAX_BODY_BYTES,
                "graphAtoms": MAX_GRAPH_ATOMS,
                "graphBonds": MAX_GRAPH_BONDS,
                "totalAtomsWithHydrogen": MAX_TOTAL_ATOMS,
            },
        })

    def do_POST(self) -> None:  # noqa: N802
        if self._path() != "/api/molecule":
            self._json(404, {"error": {"code": "not_found", "message": "Route not found."}})
            return
        content_type = self.headers.get_content_type()
        if content_type != "application/json":
            self._json(415, {"error": {
                "code": "unsupported_media_type",
                "message": "Content-Type must be application/json.",
            }})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            length = -1
        if length < 0:
            self._json(411, {"error": {"code": "length_required", "message": "A valid Content-Length is required."}})
            return
        if length > MAX_BODY_BYTES:
            self._json(413, {"error": {
                "code": "input_too_large",
                "message": f"Request body exceeds the {MAX_BODY_BYTES}-byte limit.",
            }})
            return
        try:
            raw = self.rfile.read(length)
            payload = json.loads(
                raw.decode("utf-8"),
                parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"invalid constant {value}")),
            )
            result = build_molecule(payload)
        except UnicodeDecodeError:
            self._json(400, {"error": {"code": "invalid_encoding", "message": "Request body must be UTF-8."}})
            return
        except MoleculeInputError as exc:
            self._json(exc.status, {"error": {"code": exc.code, "message": exc.message}})
            return
        except (json.JSONDecodeError, ValueError):
            self._json(400, {"error": {"code": "invalid_json", "message": "Request body is not valid JSON."}})
            return
        except Exception:
            self._json(500, {"error": {
                "code": "internal_error",
                "message": "Molecule generation failed unexpectedly.",
            }})
            return
        self._json(200, result)

    def log_message(self, format: str, *args: object) -> None:
        sys.stderr.write("molecule-api: " + (format % args) + "\n")


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8001), handler)
    print("Molecule API listening on http://127.0.0.1:8001/api/molecule", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
