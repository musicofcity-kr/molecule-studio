"""Bundle the X11 shared libraries required by RDKit's Linux cairo wheel.

Runs in Vercel's Amazon Linux build image. Only the small, explicitly allowed
library family is copied; the platform's C/C++ runtime stays platform-owned.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'chemistry' / '_native'
REQUIRED = ('libXrender.so.1', 'libX11.so.6', 'libXext.so.6', 'libexpat.so.1')
ALLOWED = re.compile(r'lib(?:X[A-Za-z0-9_-]*|xcb[A-Za-z0-9_-]*|expat|bsd|md)\.so(?:\.\d+)+$')


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def library_paths() -> dict[str, Path]:
    output = run(shutil.which('ldconfig') or '/sbin/ldconfig', '-p')
    return {name: Path(location) for name, location in re.findall(
        r'^\s*(\S+)\s+\([^\n]+\)\s+=>\s+(\S+)', output, re.MULTILINE)
        if ALLOWED.fullmatch(name)}


def prepare() -> None:
    if sys.platform != 'linux' or os.environ.get('VERCEL') != '1':
        print('Native bundle skipped: only prepared inside a Vercel Linux build.')
        return
    paths = library_paths()
    if any(name not in paths for name in REQUIRED):
        subprocess.run(['dnf', 'install', '-y', 'libXrender', 'libXext', 'expat'], check=True)
        paths = library_paths()
    DEST.mkdir(parents=True, exist_ok=True)
    bundled: dict[str, dict] = {}
    visiting: set[str] = set()
    packages: set[str] = set()

    def copy_library(name: str) -> None:
        if name in bundled:
            return
        if name in visiting:
            raise RuntimeError(f'Unexpected native dependency cycle: {name}')
        visiting.add(name)
        source = paths[name].resolve(strict=True)
        output = run('ldd', str(source))
        if 'not found' in output:
            raise RuntimeError(f'Unresolved native dependency for {name}:\n{output}')
        dependencies = []
        for dependency, location in re.findall(r'^\s*(\S+)\s+=>\s+(/\S+)', output, re.MULTILINE):
            if ALLOWED.fullmatch(dependency):
                paths[dependency] = Path(location)
                copy_library(dependency)
                dependencies.append(dependency)
        target = DEST / name
        shutil.copy2(source, target)
        bundled[name] = {'name': name, 'bytes': target.stat().st_size,
                         'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                         'dependencies': dependencies}
        visiting.remove(name)
        packages.add(run('rpm', '-qf', '--qf', '%{NAME}', str(source)).strip())

    for name in REQUIRED:
        copy_library(name)
    for package in sorted(packages):
        for filename in run('rpm', '-ql', package).splitlines():
            source = Path(filename)
            if filename.startswith('/usr/share/licenses/') and source.is_file():
                target = DEST / 'licenses' / source.relative_to('/usr/share/licenses')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    manifest = {'platform': sys.platform, 'libraries': list(bundled.values()),
                'system_packages': sorted(packages)}
    (DEST / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print('RDKit native bundle:', json.dumps(manifest))


if __name__ == '__main__':
    prepare()
