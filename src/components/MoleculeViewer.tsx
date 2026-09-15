import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Atom, Bond, Molecule } from '../types';
import { moleculeDisplayName } from '../lib/chemistry';

export type MoleculeViewerMode = 'inspect' | 'distance' | 'angle';

export type MoleculeViewerProps = {
  molecule: Molecule | null;
  displayName?: string;
  mode: MoleculeViewerMode;
  selectedAtoms: number[];
  onAtomClick: (id: number) => void;
  showHydrogens: boolean;
  showLabels: boolean;
  showOrbitals: boolean;
  resetKey: number;
  onCaptureReady?: (capture: () => string) => void;
};

type LabelRefs = Record<number, HTMLSpanElement | null>;

const ELEMENT_COLORS: Record<string, number> = {
  H: 0xf7f7f7,
  C: 0x343b46,
  N: 0x2e70d1,
  O: 0xe3483f,
  F: 0x55b86b,
  P: 0xe79b26,
  S: 0xe4c940,
  Cl: 0x2fa85a,
  Br: 0x9b3b2f,
  I: 0x783f9c,
  Si: 0xd18d67,
  B: 0xe8b33e,
};

const LABEL_COLOR: Record<string, string> = {
  H: '#53606e',
  C: '#1c2530',
  N: '#1759ba',
  O: '#c72e28',
  F: '#218c52',
  P: '#b66f00',
  S: '#9a8400',
  Cl: '#197c43',
  Br: '#7b241e',
  I: '#60317e',
  Si: '#9b5f3a',
  B: '#9d7200',
};

const ORBITAL_POSITIVE = 0x45a7ff;
const ORBITAL_NEGATIVE = 0xf075a9;
const ORBITAL_S_COLOR = 0x8a72ed;

const viewerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  minHeight: 0,
  height: '100%',
  overflow: 'hidden',
  border: '1px solid #dce3eb',
  borderRadius: 14,
  background: 'linear-gradient(145deg, #ffffff 0%, #f4f7fb 100%)',
  color: '#1b2733',
  fontFamily: 'Inter, Pretendard, system-ui, sans-serif',
};

const hudStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 3,
  top: 12,
  left: 12,
  right: 12,
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  pointerEvents: 'none',
};

const pillStyle: CSSProperties = {
  maxWidth: 'min(72%, 460px)',
  padding: '7px 10px',
  border: '1px solid rgba(190, 202, 216, .8)',
  borderRadius: 10,
  background: 'rgba(255,255,255,.88)',
  boxShadow: '0 3px 12px rgba(27, 39, 51, .08)',
  fontSize: 12,
  lineHeight: 1.35,
};

const normalizeElement = (element: string) => {
  const clean = element.trim();
  if (!clean) return 'C';
  return clean[0].toUpperCase() + clean.slice(1).toLowerCase();
};

const isHydrogen = (atom: Atom) => normalizeElement(atom.element) === 'H';

const colorForElement = (element: string) => ELEMENT_COLORS[normalizeElement(element)] ?? 0x8b98a6;

const labelColorForElement = (element: string) => LABEL_COLOR[normalizeElement(element)] ?? '#516170';

const atomRadius = (atom: Atom) => (isHydrogen(atom) ? 0.19 : 0.28);

const vectorBetween = (a: THREE.Vector3, b: THREE.Vector3) => b.clone().sub(a);

const safeUnit = (vector: THREE.Vector3, fallback = new THREE.Vector3(1, 0, 0)) => {
  if (vector.lengthSq() < 1e-8) return fallback.clone();
  return vector.normalize();
};

const perpendicularTo = (direction: THREE.Vector3) => {
  const reference = Math.abs(direction.y) < 0.85 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  return safeUnit(new THREE.Vector3().crossVectors(direction, reference));
};

const formatNumber = (value: number, digits = 2) => value.toFixed(digits).replace(/\.00$/, '');

const formatMeasurement = (mode: MoleculeViewerMode, value: number) =>
  mode === 'distance' ? `${formatNumber(value)} Å` : `${formatNumber(value, 1)}°`;

const makeCylinder = (start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material) => {
  const direction = vectorBetween(start, end);
  const length = direction.length();
  if (length < 1e-5) return null;
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 16, 1, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
};

const makeDashedLine = (points: THREE.Vector3[], color = 0x2774ca) => {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineDashedMaterial({
    color,
    dashSize: 0.1,
    gapSize: 0.07,
    linewidth: 1,
    transparent: true,
    opacity: 0.9,
  });
  const line = new THREE.Line(geometry, material);
  line.computeLineDistances();
  return line;
};

const makeLobe = (center: THREE.Vector3, direction: THREE.Vector3, positive: boolean, length = 0.42, radius = 0.13) => {
  const geometry = new THREE.SphereGeometry(1, 20, 12);
  const material = new THREE.MeshPhongMaterial({
    color: positive ? ORBITAL_POSITIVE : ORBITAL_NEGATIVE,
    transparent: true,
    opacity: 0.68,
    shininess: 40,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center).add(direction.clone().multiplyScalar(length * 0.52));
  mesh.scale.set(radius, radius, length);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  return mesh;
};

const addLobePair = (group: THREE.Group, center: THREE.Vector3, direction: THREE.Vector3, length = 0.42, radius = 0.13) => {
  const axis = safeUnit(direction);
  group.add(makeLobe(center, axis, true, length, radius));
  group.add(makeLobe(center, axis.clone().negate(), false, length * 0.46, radius * 0.72));
};

const planeNormal = (directions: THREE.Vector3[]) => {
  for (let i = 0; i < directions.length; i += 1) {
    for (let j = i + 1; j < directions.length; j += 1) {
      const normal = new THREE.Vector3().crossVectors(directions[i], directions[j]);
      if (normal.lengthSq() > 1e-8) return normal.normalize();
    }
  }
  return new THREE.Vector3(0, 0, 1);
};

const hybridizationKind = (value: string) => {
  const normalized = value.toLowerCase().replace(/[\s^₁₂₃₄]/g, '');
  if (normalized.includes('sp3')) return 'sp3';
  if (normalized.includes('sp2')) return 'sp2';
  if (normalized === 'sp' || normalized.includes('sp1')) return 'sp';
  if (normalized === 'p' || normalized.includes('p-orbital')) return 'p';
  if (normalized === 's' || normalized.includes('s-orbital')) return 's';
  return '';
};

const addOrbitals = (group: THREE.Group, atom: Atom, neighbors: THREE.Vector3[]) => {
  const kind = hybridizationKind(atom.hybridization || '');
  if (!kind) return;
  const center = new THREE.Vector3(atom.x, atom.y, atom.z);
  const directions = neighbors.map((position) => safeUnit(position.clone().sub(center)));
  if (kind === 's') {
    const geometry = new THREE.SphereGeometry(0.28, 24, 16);
    const material = new THREE.MeshPhongMaterial({ color: ORBITAL_S_COLOR, transparent: true, opacity: 0.45, depthWrite: false });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(center);
    group.add(sphere);
    return;
  }
  if (kind === 'sp' || kind === 'sp2' || kind === 'sp3') {
    const maxDirections = kind === 'sp3' ? 4 : kind === 'sp2' ? 3 : 2;
    const usable = directions.slice(0, maxDirections);
    if (usable.length === 0) usable.push(new THREE.Vector3(1, 0, 0));
    usable.forEach((direction) => addLobePair(group, center, direction, kind === 'sp3' ? 0.34 : 0.4));
    if (kind === 'sp2') {
      const normal = planeNormal(usable);
      addLobePair(group, center, normal, 0.46, 0.12);
    } else if (kind === 'sp') {
      const first = usable[0];
      const perpendicular = perpendicularTo(first);
      addLobePair(group, center, perpendicular, 0.48, 0.11);
    }
    return;
  }
  const normal = planeNormal(directions);
  addLobePair(group, center, normal, 0.52, 0.15);
};

const disposeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else if (material) material.dispose();
  });
};

export default function MoleculeViewer({
  molecule,
  displayName,
  mode,
  selectedAtoms,
  onAtomClick,
  showHydrogens,
  showLabels,
  showOrbitals,
  resetKey,
  onCaptureReady,
}: MoleculeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<LabelRefs>({});
  const measurementLabelRef = useRef<HTMLSpanElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pointerDownRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const lastMoleculeRef = useRef<Molecule | null>(null);
  const measurementRef = useRef<{ atoms: Atom[]; value: number; label: string } | null>(null);
  const moleculeRef = useRef<Molecule | null>(molecule);
  const onAtomClickRef = useRef(onAtomClick);
  const captureReadyRef = useRef(onCaptureReady);
  const updateLabelsRef = useRef<() => void>(() => {});
  const [rendererError, setRendererError] = useState<string | null>(null);

  onAtomClickRef.current = onAtomClick;
  captureReadyRef.current = onCaptureReady;
  moleculeRef.current = molecule;

  const atomById = useMemo(() => {
    const map = new Map<number, Atom>();
    molecule?.atoms.forEach((atom) => map.set(atom.id, atom));
    return map;
  }, [molecule]);

  const visibleAtoms = useMemo(
    () => molecule?.atoms.filter((atom) => showHydrogens || !isHydrogen(atom)) ?? [],
    [molecule, showHydrogens],
  );

  const selectedSet = useMemo(() => new Set(selectedAtoms), [selectedAtoms]);
  const visibleAtomsRef = useRef<Atom[]>(visibleAtoms);
  const showLabelsRef = useRef(showLabels);
  const selectedSetRef = useRef<Set<number>>(selectedSet);
  visibleAtomsRef.current = visibleAtoms;
  showLabelsRef.current = showLabels;
  selectedSetRef.current = selectedSet;

  const measurement = useMemo(() => {
    if (!molecule || (mode === 'inspect' ? true : mode === 'distance' ? selectedAtoms.length < 2 : selectedAtoms.length < 3)) return null;
    const atoms = selectedAtoms.map((id) => atomById.get(id)).filter((atom): atom is Atom => Boolean(atom));
    if (mode === 'distance') {
      const [a, b] = atoms;
      if (!a || !b) return null;
      const value = new THREE.Vector3(a.x, a.y, a.z).distanceTo(new THREE.Vector3(b.x, b.y, b.z));
      return { atoms: [a, b], value, label: formatMeasurement(mode, value) };
    }
    const [a, vertex, c] = atoms;
    if (!a || !vertex || !c) return null;
    const va = new THREE.Vector3(a.x - vertex.x, a.y - vertex.y, a.z - vertex.z);
    const vc = new THREE.Vector3(c.x - vertex.x, c.y - vertex.y, c.z - vertex.z);
    if (va.lengthSq() < 1e-8 || vc.lengthSq() < 1e-8) return null;
    const value = THREE.MathUtils.radToDeg(va.angleTo(vc));
    return { atoms: [a, vertex, c], value, label: formatMeasurement(mode, value) };
  }, [atomById, mode, molecule, selectedAtoms]);

  measurementRef.current = measurement;

  const labels = useMemo(() => visibleAtoms.map((atom) => atom.id), [visibleAtoms]);

  const updateLabels = useCallback(() => {
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return;
    const rect = container.getBoundingClientRect();
    const modelGroup = modelGroupRef.current;
    visibleAtoms.forEach((atom) => {
      const label = labelRefs.current[atom.id];
      if (!label) return;
      const point = new THREE.Vector3(atom.x, atom.y, atom.z);
      if (modelGroup) modelGroup.localToWorld(point);
      point.project(camera);
      const visible = point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1.1 && Math.abs(point.y) <= 1.1;
      label.style.opacity = visible ? '1' : '0';
      label.style.transform = `translate(-50%, -50%) translate(${(point.x * 0.5 + 0.5) * rect.width}px, ${(-point.y * 0.5 + 0.5) * rect.height}px)`;
    });
    const measurementLabel = measurementLabelRef.current;
    const currentMeasurement = measurementRef.current;
    if (measurementLabel && currentMeasurement) {
      const points = currentMeasurement.atoms.map((atom) => new THREE.Vector3(atom.x, atom.y, atom.z));
      const midpoint = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
      if (modelGroup) modelGroup.localToWorld(midpoint);
      midpoint.project(camera);
      const visible = midpoint.z > -1 && midpoint.z < 1;
      measurementLabel.style.opacity = visible ? '1' : '0';
      measurementLabel.style.transform = `translate(-50%, -50%) translate(${(midpoint.x * 0.5 + 0.5) * rect.width}px, ${(-midpoint.y * 0.5 + 0.5) * rect.height}px)`;
    } else if (measurementLabel) {
      measurementLabel.style.opacity = '0';
    }
  }, [visibleAtoms]);
  updateLabelsRef.current = updateLabels;

  useEffect(() => {
    const host = canvasHostRef.current;
    const container = containerRef.current;
    if (!host || !container) return undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      setRendererError('이 브라우저에서는 WebGL 3D 렌더러를 사용할 수 없습니다. 브라우저의 하드웨어 가속을 확인해 주세요.');
      return undefined;
    }
    setRendererError(null);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xffffff, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 2000);
    camera.position.set(0, 0, 10);
    cameraRef.current = camera;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.1;
    controls.maxDistance = 400;
    controls.saveState();
    controlsRef.current = controls;
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd7e1ee, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(4, 7, 10);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xaecbff, 1.2);
    fillLight.position.set(-6, -3, 5);
    scene.add(fillLight);

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      const width = Math.max(1, bounds.width);
      const height = Math.max(1, bounds.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      updateLabelsRef.current();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    const pointerDown = (event: PointerEvent) => {
      pointerDownRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const pointerUp = (event: PointerEvent) => {
      const start = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!start || start.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(modelGroup.children, true);
      // Only the atom body is pickable. Selection halos, outlines, orbitals and
      // measurement lines can overlap a body and must never steal its click.
      const hit = hits.find((item) => item.object.userData.pickableAtom === true);
      if (hit) onAtomClickRef.current(hit.object.userData.atomId as number);
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pointerUp);

    const animate = () => {
      controls.update();
      updateLabelsRef.current();
      renderer.render(scene, camera);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animate();

    captureReadyRef.current?.(() => {
      renderer.render(scene, camera);
      if (!showLabelsRef.current || !moleculeRef.current) return renderer.domElement.toDataURL('image/png');

      // The HTML labels sit above the WebGL canvas and are therefore absent
      // from toDataURL(). Compose their projected positions into a 2D canvas
      // synchronously so the existing capture API remains unchanged.
      const output = document.createElement('canvas');
      output.width = renderer.domElement.width;
      output.height = renderer.domElement.height;
      const context = output.getContext('2d');
      if (!context) return renderer.domElement.toDataURL('image/png');
      context.drawImage(renderer.domElement, 0, 0);
      const pixelRatio = output.width / Math.max(1, renderer.domElement.clientWidth);
      const group = modelGroupRef.current;
      const selected = selectedSetRef.current;
      context.font = `700 ${11 * pixelRatio}px Inter, Pretendard, system-ui, sans-serif`;
      context.textBaseline = 'middle';
      visibleAtomsRef.current.forEach((atom) => {
        const point = new THREE.Vector3(atom.x, atom.y, atom.z);
        if (group) group.localToWorld(point);
        point.project(camera);
        if (point.z <= -1 || point.z >= 1 || Math.abs(point.x) > 1.1 || Math.abs(point.y) > 1.1) return;
        const text = `${atom.id} · ${normalizeElement(atom.element)}`;
        const paddingX = 5 * pixelRatio;
        const boxHeight = 17 * pixelRatio;
        const boxWidth = context.measureText(text).width + paddingX * 2;
        const x = (point.x * 0.5 + 0.5) * output.width;
        const y = (-point.y * 0.5 + 0.5) * output.height;
        const left = x - boxWidth / 2;
        const top = y - boxHeight / 2;
        const radius = 5 * pixelRatio;
        const border = selected.has(atom.id) ? '#ffad00' : '#d4dce6';
        const color = selected.has(atom.id) ? '#9b6200' : labelColorForElement(atom.element);
        context.beginPath();
        context.roundRect(left, top, boxWidth, boxHeight, radius);
        context.fillStyle = 'rgba(255,255,255,.86)';
        context.fill();
        context.strokeStyle = border;
        context.lineWidth = pixelRatio;
        context.stroke();
        context.fillStyle = color;
        context.fillText(text, left + paddingX, y);
      });
      return output.toDataURL('image/png');
    });

    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      controls.dispose();
      disposeObject(modelGroup);
      renderer.dispose();
      renderer.domElement.remove();
      scene.clear();
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = modelGroupRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !scene || !camera || !controls) return;
    while (group.children.length) {
      const child = group.children.pop();
      if (child) disposeObject(child);
    }
    if (!molecule || visibleAtoms.length === 0) {
      lastMoleculeRef.current = null;
      return;
    }
    const isNewMolecule = lastMoleculeRef.current !== molecule;
    lastMoleculeRef.current = molecule;

    const positions = new Map<number, THREE.Vector3>();
    visibleAtoms.forEach((atom) => positions.set(atom.id, new THREE.Vector3(atom.x, atom.y, atom.z)));
    const box = new THREE.Box3().setFromPoints([...positions.values()]);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1);
    group.position.copy(center).multiplyScalar(-1);

    const bondMaterial = new THREE.MeshPhongMaterial({ color: 0x9ba9b8, shininess: 34 });
    molecule.bonds.forEach((bond: Bond) => {
      const start = positions.get(bond.a);
      const end = positions.get(bond.b);
      if (!start || !end) return;
      const direction = safeUnit(end.clone().sub(start));
      const offsetAxis = perpendicularTo(direction);
      const order = Math.max(1, Math.min(3, Math.round(bond.order || 1)));
      const offsets = order === 1 ? [0] : order === 2 ? [-0.095, 0.095] : [-0.12, 0, 0.12];
      offsets.forEach((offset) => {
        const mesh = makeCylinder(start.clone().add(offsetAxis.clone().multiplyScalar(offset)), end.clone().add(offsetAxis.clone().multiplyScalar(offset)), 0.055, bondMaterial);
        if (mesh) group.add(mesh);
      });
    });

    visibleAtoms.forEach((atom) => {
      const position = positions.get(atom.id);
      if (!position) return;
      const element = normalizeElement(atom.element);
      const material = new THREE.MeshPhongMaterial({ color: colorForElement(element), shininess: 65 });
      const atomMesh = new THREE.Mesh(new THREE.SphereGeometry(atomRadius(atom), 28, 18), material);
      atomMesh.position.copy(position);
      atomMesh.userData.atomId = atom.id;
      atomMesh.userData.pickableAtom = true;
      group.add(atomMesh);
      if (selectedSet.has(atom.id)) {
        const selectedMaterial = new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.32, side: THREE.BackSide });
        const halo = new THREE.Mesh(new THREE.SphereGeometry(atomRadius(atom) * 1.34, 22, 14), selectedMaterial);
        halo.position.copy(position);
        halo.userData.atomId = atom.id;
        group.add(halo);
        const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xff9f00, transparent: true, opacity: 0.95 });
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.SphereGeometry(atomRadius(atom) * 1.23, 12, 8)), edgeMaterial);
        edges.position.copy(position);
        edges.userData.atomId = atom.id;
        group.add(edges);
      }
      if (showOrbitals && selectedSet.has(atom.id)) {
        const orbitalGroup = new THREE.Group();
        const neighborPositions = (atom.neighbors ?? []).map((id) => positions.get(id)).filter((item): item is THREE.Vector3 => Boolean(item));
        addOrbitals(orbitalGroup, atom, neighborPositions);
        group.add(orbitalGroup);
      }
    });

    if (measurement) {
      const measurementGroup = new THREE.Group();
      const points = measurement.atoms.map((atom) => positions.get(atom.id)).filter((item): item is THREE.Vector3 => Boolean(item));
      if (mode === 'distance' && points.length === 2) measurementGroup.add(makeDashedLine(points));
      if (mode === 'angle' && points.length === 3) {
        measurementGroup.add(makeDashedLine([points[0], points[1]]));
        measurementGroup.add(makeDashedLine([points[1], points[2]]));
      }
      group.add(measurementGroup);
    }

    if (!isNewMolecule) return;
    const distance = Math.max(extent * 2.25, 4.5);
    camera.position.set(0, extent * 0.2, distance);
    controls.target.set(0, 0, 0);
    camera.near = Math.max(0.01, extent / 100);
    camera.far = Math.max(100, extent * 100);
    camera.updateProjectionMatrix();
    controls.saveState();
  }, [molecule, mode, measurement, selectedSet, showHydrogens, showOrbitals, visibleAtoms]);

  useEffect(() => {
    controlsRef.current?.reset();
  }, [resetKey]);

  const registerLabel = useCallback((id: number) => (node: HTMLSpanElement | null) => {
    labelRefs.current[id] = node;
  }, []);

  const measurementText = measurement ? `${measurement.atoms.map((atom) => atom.id).join('–')}  ${measurement.label}` : null;
  const orbitalAtom = showOrbitals && selectedAtoms.length ? atomById.get(selectedAtoms[0]) : undefined;

  return (
    <div ref={containerRef} style={viewerStyle} role="application" aria-label="분자 3차원 구조 뷰어">
      <div ref={canvasHostRef} style={{ position: 'absolute', inset: 0 }} />
      {rendererError ? (
        <div style={{ ...pillStyle, position: 'absolute', inset: '50% auto auto 50%', transform: 'translate(-50%, -50%)', maxWidth: '80%', textAlign: 'center', color: '#9b2727' }}>
          {rendererError}
        </div>
      ) : !molecule ? (
        <div style={{ ...pillStyle, position: 'absolute', inset: '50% auto auto 50%', transform: 'translate(-50%, -50%)', maxWidth: '80%', textAlign: 'center' }}>
          표시할 분자를 선택해 주세요.
        </div>
      ) : null}
      <div style={hudStyle} aria-live="polite">
        <div style={pillStyle}>
          <strong style={{ display: 'inline-block', maxWidth: 'min(58vw, 520px)', overflowWrap: 'anywhere', verticalAlign: 'middle' }}>{displayName ?? moleculeDisplayName(molecule?.name)}</strong>
          {molecule ? <span style={{ marginLeft: 7, color: '#627386' }}>{molecule.formula}</span> : null}
          {measurementText ? <div style={{ marginTop: 3, color: '#155da7', fontWeight: 700 }}>{mode === 'angle' ? '각도' : '거리'} · {measurementText}</div> : null}
        </div>
        {orbitalAtom ? <div style={{ ...pillStyle, color: '#34404d' }}>혼성 오비탈 개념도 · 양자화학 계산 아님 · {orbitalAtom.id} ({hybridizationKind(orbitalAtom.hybridization) || 'unknown'})</div> : null}
      </div>
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }} aria-hidden="true">
        {showLabels && labels.map((id) => {
          const atom = atomById.get(id);
          if (!atom) return null;
          return (
            <span
              key={id}
              className="atom-label"
              ref={registerLabel(id)}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                opacity: 0,
                padding: '2px 5px',
                borderRadius: 5,
                background: 'rgba(255,255,255,.86)',
                border: `1px solid ${selectedSet.has(id) ? '#ffad00' : '#d4dce6'}`,
                color: selectedSet.has(id) ? '#9b6200' : labelColorForElement(atom.element),
                boxShadow: '0 1px 5px rgba(40, 55, 70, .14)',
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {id} · {normalizeElement(atom.element)}
            </span>
          );
        })}
        <span
          ref={measurementLabelRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            opacity: 0,
            padding: '4px 7px',
            borderRadius: 6,
            background: 'rgba(255,255,255,.94)',
            border: '1px solid #2774ca',
            color: '#155da7',
            boxShadow: '0 2px 8px rgba(40, 85, 130, .18)',
            fontSize: 12,
            fontWeight: 800,
            whiteSpace: 'nowrap',
          }}
        >
          {measurement?.label ?? ''}
        </span>
      </div>
      <div className="viewer-help" style={{ position: 'absolute', bottom: 10, left: 12, zIndex: 3, ...pillStyle, maxWidth: 'calc(100% - 24px)', color: '#637387', pointerEvents: 'none' }}>
        드래그: 회전 · 휠: 확대 · 우클릭 드래그: 이동 · 원자를 눌러 측정
      </div>
      <div style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }} aria-label="원자 선택">
        {visibleAtoms.map((atom) => (
          <button key={atom.id} type="button" onClick={() => onAtomClick(atom.id)} aria-label={`${atom.id}번 ${normalizeElement(atom.element)} 원자 선택`}>
            {atom.id}
          </button>
        ))}
      </div>
    </div>
  );
}
