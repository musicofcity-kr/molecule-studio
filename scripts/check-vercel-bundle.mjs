// Regression: static-build's Python install must not enter the API bundle again.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const pattern = config.functions['api/molecule.py'].excludeFiles;
const excluded = [
  '.vercel_python_packages/rdkit/Chem/rdchem.cpython-314-x86_64-linux-gnu.so',
  '.vercel_python_packages/rdkit.libs/libRDKitGraphMol.so',
  '.vercel_python_packages/numpy/_core/_multiarray_umath.so',
  '.vercel_python_packages/numpy.libs/libopenblas.so',
  '.vercel_python_packages/PIL/Image.py',
  'node_modules/three/build/three.module.js',
  '.venv/Lib/site-packages/rdkit/__init__.py',
];
const retained = [
  'api/molecule.py', 'chemistry/model.py', 'chemistry/vsepr.py',
  'chemistry/spectra.py', 'requirements.txt',
  'chemistry/_native/libXrender.so.1', 'chemistry/_native/manifest.json',
  '_vendor/rdkit/Chem/rdchem.cpython-313-x86_64-linux-gnu.so',
  '_vendor/rdkit/Data/FragmentDescriptors.csv',
  '_vendor/rdkit.libs/libRDKitGraphMol.so',
  '_vendor/numpy.libs/libopenblas.so', '_vendor/PIL/Image.py',
];
for (const file of excluded) assert(matchesGlob(file, pattern), `Duplicate/dev file retained: ${file}`);
for (const file of retained) assert(!matchesGlob(file, pattern), `Runtime file excluded: ${file}`);
assert.equal(config.installCommand, undefined, 'Keep automatic Python dependency optimization enabled');
console.log(JSON.stringify({ result: 'PASS', excluded: excluded.length, retained: retained.length,
  scope: 'Project bundle glob regression; deployed bundle size and runtime require remote verification' }));
