import type { Atom, Bond, EditorAtom, EditorBond, Measurement, Molecule, Vsepr } from '../types';

export type EditorGraph = { atoms: EditorAtom[]; bonds: EditorBond[] };

export const elementColors: Record<string, string> = {
  C: '#334155', N: '#247ba0', O: '#e45757', S: '#d49220', P: '#e07a27', F: '#1d9b75', Cl: '#1d9b75', Br: '#a24f35', I: '#7b5daa', H: '#e8edf2', B: '#a87822', Si: '#a56b45',
};

export const examples = [
  { label: '물', name: '물', smiles: 'O' },
  { label: '에탄올', name: '에탄올', smiles: 'CCO' },
  { label: '카페인', name: '카페인', smiles: 'Cn1cnc2c1c(=O)n(C)c(=O)n2C' },
  { label: '아스피린', name: '아스피린', smiles: 'CC(=O)Oc1ccccc1C(=O)O' },
];

function fitGraph(atoms: EditorAtom[], bonds: EditorBond[]): EditorGraph {
  if (!atoms.length) return { atoms: [], bonds: [] };
  const xs = atoms.map((atom) => atom.x);
  const ys = atoms.map((atom) => atom.y);
  const lowX = Math.min(...xs), highX = Math.max(...xs);
  const lowY = Math.min(...ys), highY = Math.max(...ys);
  const spanX = Math.max(highX - lowX, 0.01), spanY = Math.max(highY - lowY, 0.01);
  const scale = Math.min(310 / spanX, 190 / spanY, 92);
  const centerX = (lowX + highX) / 2, centerY = (lowY + highY) / 2;
  return {
    atoms: atoms.map((atom) => ({ ...atom, x: 190 + (atom.x - centerX) * scale, y: 130 - (atom.y - centerY) * scale })),
    bonds,
  };
}

/** Converts the server's RDKit 2D V2000 mol block into the editable canvas graph. */
function graphFromMolblock(molblock: string): EditorGraph | null {
  const lines = molblock.replace(/\r/g, '').split('\n');
  if (lines.length < 5) return null;
  const countLine = lines[3];
  const atomCount = Number.parseInt(countLine.slice(0, 3).trim(), 10);
  const bondCount = Number.parseInt(countLine.slice(3, 6).trim(), 10);
  if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount) || atomCount < 1 || lines.length < 4 + atomCount + bondCount) return null;
  const atoms: EditorAtom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const fields = lines[4 + index].trim().split(/\s+/);
    const x = Number(fields[0]), y = Number(fields[1]), element = fields[3];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !element) return null;
    atoms.push({ id: index, element, x, y, charge: 0 });
  }
  const bonds: EditorBond[] = [];
  for (let index = 0; index < bondCount; index += 1) {
    const fields = lines[4 + atomCount + index].trim().split(/\s+/);
    const a = Number(fields[0]) - 1, b = Number(fields[1]) - 1, order = Number(fields[2]);
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isFinite(order) || !atoms[a] || !atoms[b]) return null;
    bonds.push({ a, b, order });
  }
  return fitGraph(atoms, bonds);
}

export function graphFromMolecule(molecule: Molecule): EditorGraph {
  const fromMolblock = graphFromMolblock(molecule.molblock);
  if (fromMolblock) return {
    ...fromMolblock,
    atoms: fromMolblock.atoms.map((atom) => ({
      ...atom,
      charge: molecule.atoms.find((source) => source.id === atom.id && source.element === atom.element)?.charge ?? atom.charge,
    })),
  };
  // A defensive fallback for old saved entries without a 2D mol block. Hydrogens
  // are intentionally omitted, because they make the hand editor unreadable.
  const atoms = molecule.atoms.filter((atom) => atom.element !== 'H').map((atom) => ({ id: atom.id, element: atom.element, x: atom.x, y: atom.y, charge: atom.charge }));
  const ids = new Set(atoms.map((atom) => atom.id));
  return fitGraph(atoms, molecule.bonds.filter((bond) => ids.has(bond.a) && ids.has(bond.b)).map((bond) => ({ a: bond.a, b: bond.b, order: bond.order })));
}

export function graphMolblock(graph: EditorGraph): string {
  const atomIndex = new Map(graph.atoms.map((atom, index) => [atom.id, index + 1]));
  const header = ['Molecule Studio', '  UAISE', ''];
  const counts = `${String(graph.atoms.length).padStart(3)}${String(graph.bonds.length).padStart(3)}  0  0  0  0            999 V2000`;
  const atoms = graph.atoms.map((atom) => `${(atom.x / 100).toFixed(4).padStart(10)} ${(atom.y / 100).toFixed(4).padStart(9)} 0.0000 ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  const bonds = graph.bonds.map((bond) => `${String(atomIndex.get(bond.a) ?? 0).padStart(3)}${String(atomIndex.get(bond.b) ?? 0).padStart(3)}${String(bond.order).padStart(3)}  0  0  0  0`);
  return [...header, counts, ...atoms, ...bonds, 'M  END'].join('\n');
}

export function calculateMeasurement(atoms: Atom[], ids: number[], kind: 'distance' | 'angle'): Measurement | null {
  const points = ids.map((id) => atoms.find((atom) => atom.id === id)).filter(Boolean) as Atom[];
  if ((kind === 'distance' && points.length !== 2) || (kind === 'angle' && points.length !== 3)) return null;
  if (kind === 'distance') {
    const [a, b] = points;
    const value = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    return { kind, atoms: ids, value, label: `${a.element}${a.id} — ${b.element}${b.id}: ${value.toFixed(2)} Å` };
  }
  const [a, b, c] = points;
  const u = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = u.reduce((sum, value, index) => sum + value * v[index], 0);
  const mag = Math.hypot(...u) * Math.hypot(...v);
  const value = mag ? Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI : 0;
  return { kind, atoms: ids, value, label: `∠ ${a.element}${a.id} — ${b.element}${b.id} — ${c.element}${c.id}: ${value.toFixed(1)}°` };
}

export function selectedVsepr(molecule: Molecule | null, selected: number[]): Vsepr | null {
  if (!molecule || !selected.length) return null;
  return molecule.vsepr.find((item) => item.atomId === selected.at(-1)) ?? null;
}

export function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
}

export function spectrumPath(points: { x: number; y: number }[], width: number, height: number): string {
  if (!points.length) return '';
  return points.map((point, index) => `${index ? 'L' : 'M'} ${(point.x * width).toFixed(1)} ${(height - point.y * height).toFixed(1)}`).join(' ');
}
