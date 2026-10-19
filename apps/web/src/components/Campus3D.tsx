import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ResolvedTheme } from '../theme';

/**
 * Landing-page hero: a small low-poly campus built from primitives. A columned college
 * hall with a working clock, a graduation cap, a book stack with a globe, a pencil and
 * a floating glass timetable. Loaded lazily so three.js never touches the app bundle.
 */

type Role =
  | 'wall'
  | 'trim'
  | 'roof'
  | 'door'
  | 'clockFace'
  | 'ink'
  | 'cap'
  | 'gold'
  | 'bookA'
  | 'bookB'
  | 'bookC'
  | 'pages'
  | 'globe'
  | 'stand'
  | 'pencil'
  | 'wood'
  | 'eraser'
  | 'metal'
  | 'glass'
  | 'cellA'
  | 'cellB'
  | 'cellC'
  | 'cellD'
  | 'orb';

const PALETTES: Record<ResolvedTheme, Record<Role, string>> = {
  light: {
    wall: '#f8f9fd',
    trim: '#e6e9f5',
    roof: '#6366f1',
    door: '#4338ca',
    clockFace: '#ffffff',
    ink: '#1e1b4b',
    cap: '#1f2340',
    gold: '#f5b301',
    bookA: '#6366f1',
    bookB: '#f59e0b',
    bookC: '#14b8a6',
    pages: '#fffaf0',
    globe: '#38bdf8',
    stand: '#8b5cf6',
    pencil: '#fbbf24',
    wood: '#f3d2a2',
    eraser: '#fb7185',
    metal: '#cbd5e1',
    glass: '#ffffff',
    cellA: '#818cf8',
    cellB: '#fbbf24',
    cellC: '#34d399',
    cellD: '#c084fc',
    orb: '#a855f7',
  },
  dark: {
    wall: '#c9cde3',
    trim: '#9ea4c4',
    roof: '#7c83ff',
    door: '#312e81',
    clockFace: '#eef0ff',
    ink: '#1e1b4b',
    cap: '#161a2e',
    gold: '#fcd34d',
    bookA: '#818cf8',
    bookB: '#fbbf24',
    bookC: '#2dd4bf',
    pages: '#f1ede4',
    globe: '#38bdf8',
    stand: '#a78bfa',
    pencil: '#fbbf24',
    wood: '#e9c58f',
    eraser: '#fb7185',
    metal: '#94a3b8',
    glass: '#c7d2fe',
    cellA: '#818cf8',
    cellB: '#fbbf24',
    cellC: '#34d399',
    cellD: '#c084fc',
    orb: '#c084fc',
  },
};

interface Floating {
  object: THREE.Object3D;
  base: THREE.Vector3;
  baseRotation: THREE.Euler;
  amplitude: number;
  speed: number;
  phase: number;
  spin?: number;
}

export default function Campus3D({ theme }: { theme: ResolvedTheme }) {
  const host = useRef<HTMLDivElement>(null);
  const materials = useRef<Partial<Record<Role, THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>>>({});
  const renderOnce = useRef<() => void>(() => {});

  useEffect(() => {
    const container = host.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      container.classList.add('no-webgl');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    const target = new THREE.Vector3(0, 1.85, 0);

    scene.add(new THREE.HemisphereLight('#ffffff', '#8088b0', 0.6));
    const key = new THREE.DirectionalLight('#ffffff', 1.4);
    key.position.set(4, 8, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight('#a5b4fc', 0.8);
    rim.position.set(-6, 3, -4);
    scene.add(rim);

    // ---- Materials, recoloured in place when the theme changes ----
    const palette = PALETTES[theme];
    const mat = (role: Role, options: THREE.MeshStandardMaterialParameters = {}) => {
      const material = new THREE.MeshStandardMaterial({ color: palette[role], roughness: 0.5, metalness: 0.05, ...options });
      materials.current[role] = material;
      return material;
    };
    const m = {
      wall: mat('wall', { roughness: 0.65 }),
      trim: mat('trim', { roughness: 0.55 }),
      roof: mat('roof', { roughness: 0.35, metalness: 0.15 }),
      door: mat('door', { roughness: 0.4 }),
      clockFace: mat('clockFace', { roughness: 0.3 }),
      ink: mat('ink', { roughness: 0.4 }),
      cap: mat('cap', { roughness: 0.55 }),
      gold: mat('gold', { roughness: 0.25, metalness: 0.7 }),
      bookA: mat('bookA', { roughness: 0.45 }),
      bookB: mat('bookB', { roughness: 0.45 }),
      bookC: mat('bookC', { roughness: 0.45 }),
      pages: mat('pages', { roughness: 0.9 }),
      globe: mat('globe', { roughness: 0.3, metalness: 0.1 }),
      stand: mat('stand', { roughness: 0.3, metalness: 0.4 }),
      pencil: mat('pencil', { roughness: 0.4 }),
      wood: mat('wood', { roughness: 0.8 }),
      eraser: mat('eraser', { roughness: 0.7 }),
      metal: mat('metal', { roughness: 0.25, metalness: 0.8 }),
      cellA: mat('cellA', { roughness: 0.3 }),
      cellB: mat('cellB', { roughness: 0.3 }),
      cellC: mat('cellC', { roughness: 0.3 }),
      cellD: mat('cellD', { roughness: 0.3 }),
      orb: mat('orb', { roughness: 0.15, metalness: 0.2 }),
    };
    const glass = new THREE.MeshPhysicalMaterial({
      color: palette.glass,
      roughness: 0.08,
      metalness: 0,
      transmission: 0.92,
      thickness: 0.6,
      ior: 1.4,
      transparent: true,
      opacity: 0.9,
      clearcoat: 1,
    });
    materials.current.glass = glass;

    const box = (w: number, h: number, d: number, material: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    const cylinder = (rTop: number, rBottom: number, h: number, material: THREE.Material, segments = 24) =>
      new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);

    const root = new THREE.Group();
    scene.add(root);
    const floating: Floating[] = [];
    const float = (object: THREE.Object3D, amplitude: number, speed: number, phase: number, spin = 0) => {
      floating.push({
        object,
        base: object.position.clone(),
        baseRotation: object.rotation.clone(),
        amplitude,
        speed,
        phase,
        spin,
      });
    };

    // ---- College hall ----
    const hall = new THREE.Group();
    const plinth = box(4.6, 0.26, 2.7, m.trim);
    plinth.position.y = 0.13;
    const steps = [0, 1, 2].map((i) => {
      const step = box(2.2 - i * 0.2, 0.1, 0.32, m.trim);
      step.position.set(0, 0.05 + i * 0.1, 1.5 - i * 0.18);
      return step;
    });
    const floor = box(4.1, 0.14, 2.3, m.wall);
    floor.position.y = 0.33;
    const backWall = box(3.7, 1.8, 1.5, m.wall);
    backWall.position.set(0, 1.3, -0.25);
    const door = box(0.7, 1.05, 0.05, m.door);
    door.position.set(0, 0.93, 0.52);
    const windows = [-1.25, 1.25].map((x) => {
      const pane = box(0.55, 0.7, 0.05, m.roof);
      pane.position.set(x, 1.3, 0.52);
      return pane;
    });
    const columns = [-1.7, -1.02, -0.34, 0.34, 1.02, 1.7].map((x) => {
      const column = cylinder(0.13, 0.15, 1.82, m.wall, 16);
      column.position.set(x, 1.31, 0.92);
      const capital = box(0.36, 0.1, 0.36, m.trim);
      capital.position.set(x, 2.27, 0.92);
      return [column, capital];
    });
    const beam = box(4.3, 0.26, 2.5, m.trim);
    beam.position.y = 2.45;
    const pedimentShape = new THREE.Shape();
    pedimentShape.moveTo(-2.25, 0);
    pedimentShape.lineTo(2.25, 0);
    pedimentShape.lineTo(0, 0.95);
    pedimentShape.closePath();
    const pediment = new THREE.Mesh(
      new THREE.ExtrudeGeometry(pedimentShape, { depth: 2.4, bevelEnabled: false }),
      m.roof,
    );
    pediment.position.set(0, 2.58, -1.2);

    // A clock that shows the real time.
    const clock = new THREE.Group();
    const face = cylinder(0.32, 0.32, 0.06, m.clockFace, 32);
    face.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.035, 10, 40), m.gold);
    const hourHand = box(0.035, 0.17, 0.02, m.ink);
    hourHand.geometry.translate(0, 0.085, 0);
    const minuteHand = box(0.025, 0.26, 0.02, m.ink);
    minuteHand.geometry.translate(0, 0.13, 0);
    hourHand.position.z = 0.045;
    minuteHand.position.z = 0.055;
    clock.add(face, ring, hourHand, minuteHand);
    clock.position.set(0, 2.93, 1.22);

    hall.add(plinth, ...steps, floor, backWall, door, ...windows, ...columns.flat(), beam, pediment, clock);
    root.add(hall);

    // Soft contact shadow under the hall.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const ctx = shadowCanvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(30, 27, 75, 0.35)');
    gradient.addColorStop(1, 'rgba(30, 27, 75, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 4.5),
      new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.01;
    root.add(shadow);

    // ---- Graduation cap ----
    const cap = new THREE.Group();
    const board = box(1.5, 0.07, 1.5, m.cap);
    board.rotation.y = Math.PI / 4;
    const skull = cylinder(0.5, 0.56, 0.42, m.cap, 28);
    skull.position.y = -0.24;
    const button = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), m.gold);
    button.position.y = 0.06;
    const cord = box(0.03, 0.02, 0.95, m.gold);
    cord.position.set(0.33, 0.05, 0.33);
    cord.rotation.y = Math.PI / 4;
    const tassel = cylinder(0.05, 0.08, 0.38, m.gold, 12);
    tassel.position.set(0.66, -0.15, 0.66);
    cap.add(board, skull, button, cord, tassel);
    cap.position.set(3.15, 3.6, 0.3);
    cap.rotation.set(0.32, 0.4, -0.22);
    root.add(cap);
    float(cap, 0.14, 0.9, 0, 0.12);

    // ---- Book stack with a globe ----
    const books = new THREE.Group();
    [
      [m.bookA, 0, 0.08],
      [m.bookB, 0.3, -0.12],
      [m.bookC, 0.6, 0.05],
    ].forEach(([cover, y, turn]) => {
      const book = new THREE.Group();
      const shell = box(1.45, 0.28, 1.0, cover as THREE.Material);
      const pages = box(1.36, 0.22, 0.96, m.pages);
      pages.position.set(0.06, 0, 0);
      book.add(shell, pages);
      book.position.y = (y as number) + 0.14;
      book.rotation.y = turn as number;
      books.add(book);
    });
    const globe = new THREE.Group();
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 3), m.globe);
    const lines = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.43, 1),
      new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.35 }),
    );
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 8, 40, Math.PI * 1.2), m.stand);
    arc.rotation.set(0, Math.PI / 2, -Math.PI * 0.6);
    const stem = cylinder(0.03, 0.03, 0.25, m.stand, 8);
    stem.position.y = -0.55;
    const foot = cylinder(0.22, 0.26, 0.06, m.stand, 24);
    foot.position.y = -0.68;
    const spinning = new THREE.Group();
    spinning.add(sphere, lines);
    spinning.rotation.z = 0.41;
    globe.add(spinning, arc, stem, foot);
    globe.position.set(0.05, 1.55, 0);
    books.add(globe);
    books.position.set(-3.35, 0, 1.1);
    books.rotation.y = 0.35;
    root.add(books);

    // ---- Pencil ----
    const pencil = new THREE.Group();
    const body = cylinder(0.1, 0.1, 1.7, m.pencil, 6);
    const tipWood = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 6), m.wood);
    tipWood.position.y = -1.0;
    tipWood.rotation.x = Math.PI;
    const lead = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.1, 6), m.ink);
    lead.position.y = -1.12;
    lead.rotation.x = Math.PI;
    const band = cylinder(0.105, 0.105, 0.14, m.metal, 16);
    band.position.y = 0.92;
    const eraser = cylinder(0.1, 0.1, 0.16, m.eraser, 16);
    eraser.position.y = 1.07;
    pencil.add(body, tipWood, lead, band, eraser);
    pencil.position.set(3.3, 1.05, 1.5);
    pencil.rotation.set(0.2, 0, -0.95);
    root.add(pencil);
    float(pencil, 0.1, 1.3, 1.7, 0.05);

    // ---- Floating glass timetable ----
    const board3d = new THREE.Group();
    const pane = box(2.3, 1.55, 0.06, glass);
    board3d.add(pane);
    const cells = [m.cellA, m.cellB, m.cellC, m.cellD];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        if ((row * 5 + col) % 7 === 3) continue;
        const cell = box(0.34, 0.24, 0.05, cells[(row * 2 + col * 3) % 4]);
        cell.position.set(-0.88 + col * 0.44, 0.48 - row * 0.32, 0.06);
        board3d.add(cell);
      }
    }
    board3d.position.set(-2.6, 3.55, -1.4);
    board3d.rotation.set(-0.05, 0.42, 0.04);
    root.add(board3d);
    float(board3d, 0.12, 0.7, 3.1);

    // ---- Orbs ----
    [
      [-0.9, 4.35, -0.6, 0.16],
      [1.7, 4.1, -1.2, 0.11],
      [-4.2, 2.3, -0.4, 0.12],
      [4.2, 2.2, -0.8, 0.09],
    ].forEach(([x, y, z, r], index) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), index % 2 ? m.cellB : m.orb);
      orb.position.set(x, y, z);
      root.add(orb);
      float(orb, 0.18, 1 + index * 0.2, index * 1.3);
    });

    // ---- Sizing: keep the whole scene in frame at any aspect ratio ----
    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      const halfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const distance = Math.max(2.6 / halfFov, 4.3 / (halfFov * camera.aspect));
      camera.position.set(0, target.y + distance * 0.2, distance);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };
    resize();

    // ---- Interaction and animation ----
    const pointer = { x: 0, y: 0 };
    const onPointer = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = new THREE.Clock();
    let frame = 0;
    let visible = true;

    const setClock = () => {
      const now = new Date();
      const minutes = now.getMinutes() + now.getSeconds() / 60;
      minuteHand.rotation.z = -(minutes / 60) * Math.PI * 2;
      hourHand.rotation.z = -(((now.getHours() % 12) + minutes / 60) / 12) * Math.PI * 2;
    };

    const draw = () => {
      const t = timer.getElapsedTime();
      if (!reduced) {
        root.rotation.y += (pointer.x * 0.28 + Math.sin(t * 0.25) * 0.08 - root.rotation.y) * 0.05;
        root.rotation.x += (pointer.y * 0.06 - root.rotation.x) * 0.05;
        for (const item of floating) {
          item.object.position.y = item.base.y + Math.sin(t * item.speed + item.phase) * item.amplitude;
          if (item.spin) item.object.rotation.y = item.baseRotation.y + Math.sin(t * 0.5 + item.phase) * item.spin * 3;
        }
        spinning.rotation.y = t * 0.4;
      }
      setClock();
      renderer.render(scene, camera);
    };
    renderOnce.current = draw;

    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (visible && !document.hidden) draw();
    };
    if (reduced) draw();
    else loop();

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    observer.observe(container);
    const sizeObserver = new ResizeObserver(() => {
      resize();
      if (reduced) draw();
    });
    sizeObserver.observe(container);
    container.classList.add('ready');

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointer);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
      shadowTexture.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      materials.current = {};
    };
    // The scene is built once; theme changes only recolour it (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const palette = PALETTES[theme];
    for (const [role, material] of Object.entries(materials.current)) {
      material?.color.set(palette[role as Role]);
    }
    renderOnce.current();
  }, [theme]);

  return <div ref={host} className="campus-3d" aria-hidden="true" />;
}
