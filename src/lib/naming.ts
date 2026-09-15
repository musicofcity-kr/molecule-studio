import type { Molecule, MoleculeNaming } from '../types';

const genericNames = new Set(['', 'Molecule', '분자', '분자(Molecule)']);

export function meaningfulMoleculeName(name?: string | null): string | null {
  const value = name?.trim() ?? '';
  return genericNames.has(value) ? null : value;
}

export function validMoleculeNaming(value: unknown, expectedSmiles: string): MoleculeNaming | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<MoleculeNaming>;
  if (item.smiles !== expectedSmiles || !['available', 'not_found', 'unavailable'].includes(item.status ?? '')) return null;
  if (item.iupacName !== null && (typeof item.iupacName !== 'string' || !item.iupacName.trim() || item.iupacName.length > 512)) return null;
  if (item.commonName !== null && (typeof item.commonName !== 'string' || !item.commonName.trim() || item.commonName.length > 512)) return null;
  if (item.source !== null && item.source !== 'PubChem') return null;
  if (item.sourceUrl !== null && typeof item.sourceUrl !== 'string') return null;
  if (item.cid !== null && (typeof item.cid !== 'number' || !Number.isInteger(item.cid) || item.cid <= 0)) return null;
  if (item.status === 'available' && (typeof item.iupacName !== 'string' || item.source !== 'PubChem' || typeof item.cid !== 'number')) return null;
  return item as MoleculeNaming;
}

export function resolvedMoleculeName(molecule: Molecule, naming: MoleculeNaming | null, loading = false) {
  const knownName = meaningfulMoleculeName(naming?.commonName) ?? meaningfulMoleculeName(molecule.name);
  if (loading || !naming || naming.status !== 'available') return { title: knownName ?? molecule.formula, titleKind: knownName ? 'common' as const : 'formula' as const, iupacName: null, statusText: loading ? 'IUPAC 이름 확인 중' : '이름 확인 불가' };
  const commonName = meaningfulMoleculeName(naming.commonName) ?? knownName;
  const iupacName = meaningfulMoleculeName(naming.iupacName);
  return { title: commonName ?? iupacName ?? molecule.formula, titleKind: commonName ? 'common' as const : iupacName ? 'iupac' as const : 'formula' as const, iupacName: commonName && iupacName && commonName !== iupacName ? iupacName : null, statusText: null };
}

export function pubChemCompoundUrl(naming: MoleculeNaming | null): string | null {
  if (naming?.source !== 'PubChem' || !Number.isInteger(naming.cid) || (naming.cid ?? 0) <= 0) return null;
  return `https://pubchem.ncbi.nlm.nih.gov/compound/${naming.cid}`;
}
