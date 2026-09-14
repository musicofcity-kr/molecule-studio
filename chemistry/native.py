"""Load build-bundled Linux drawing dependencies before importing RDKit Draw."""
from __future__ import annotations

import ctypes
import json
from pathlib import Path
import sys

_HANDLES = []


def load_drawing_libraries() -> None:
    if sys.platform != 'linux' or _HANDLES:
        return
    directory = Path(__file__).resolve().parent / '_native'
    manifest = directory / 'manifest.json'
    if not manifest.is_file():
        return  # Local installations use their normal system libraries.
    for library in json.loads(manifest.read_text(encoding='utf-8'))['libraries']:
        name = library['name']
        if Path(name).name != name:
            raise ValueError('Native manifest entries must be library filenames')
        _HANDLES.append(ctypes.CDLL(str(directory / name), mode=ctypes.RTLD_GLOBAL))
