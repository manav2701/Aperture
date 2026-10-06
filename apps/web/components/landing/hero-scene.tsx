'use client';

import { useEffect, useRef } from 'react';
import type * as ThreeModule from 'three';

type Three = typeof ThreeModule;

/** Golden-ratio sequence: evenly spread values in [0, 1) without randomness, so every visit looks the same. */
function spread(i: number, step = 0.6180339887) {
  return (i * step) % 1;
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const PACKETS = 84;
const CYCLE_SECONDS = 6.5;
const START_X = -15;
const END_X = 12;
/** The three rails requests arrive on: model calls, card swipes, stablecoin payments. */
const LANES = [
  { y: 1.1, z: -3.6 },
  { y: 0, z: 0 },
  { y: -1.1, z: 3.6 },
] as const;

/** Where a request on `lane` sits at approach progress p (0 = far away, 1 = at the gate). */
function approach(lane: (typeof LANES)[number], p: number) {
  const pull = 1 - smoothstep(0.3, 1, p);
  return { x: START_X + -START_X * p, y: lane.y * pull, z: lane.z * pull };
}

function cssColor(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Builds the scene: the Signal mark as a gate, with requests streaming in from three rails. Allowed
 * ones pass through the pupil and turn accent; blocked ones bounce off and fall away. Returns a
 * cleanup function.
 */
function mount(THREE: Three, host: HTMLDivElement, labels: HTMLElement[]): () => void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(16, 10, 17);
  camera.lookAt(-1.5, 0, 0);
  const halfHeight = 7.2;

  scene.add(new THREE.AmbientLight(0xffffff, 1.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(6, 12, 9);
  scene.add(sun);

  const world = new THREE.Group();
  scene.add(world);

  // The gate: the logo's bars, standing in the plane the requests cross.
  const fgMaterial = new THREE.MeshLambertMaterial();
  const accentMaterial = new THREE.MeshLambertMaterial();
  const scale = 0.11;
  const bars: [number, number, number, number][] = [
    [22, 15, 20, 4],
    [11, 22, 42, 4],
    [4, 30, 20, 4],
    [40, 30, 20, 4],
    [11, 38, 42, 4],
    [22, 45, 20, 4],
  ];
  const geometries: ThreeModule.BufferGeometry[] = [];
  for (const [x, y, w, h] of bars) {
    const geometry = new THREE.BoxGeometry(0.55, h * scale, w * scale);
    geometries.push(geometry);
    const bar = new THREE.Mesh(geometry, fgMaterial);
    bar.position.set(0, (32 - (y + h / 2)) * scale, (x + w / 2 - 32) * scale);
    world.add(bar);
  }
  const pupilGeometry = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  geometries.push(pupilGeometry);
  const pupil = new THREE.Mesh(pupilGeometry, accentMaterial);
  world.add(pupil);

  // Rails and the exit path, drawn as thin lines.
  const lineMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 });
  for (const lane of LANES) {
    const points = Array.from({ length: 48 }, (_, i) => {
      const at = approach(lane, (i / 47) * 0.97);
      return new THREE.Vector3(at.x, at.y, at.z);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometries.push(geometry);
    world.add(new THREE.Line(geometry, lineMaterial));
  }
  const exitMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 });
  const exitGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.6, 0, 0),
    new THREE.Vector3(END_X, 0, 0),
  ]);
  geometries.push(exitGeometry);
  world.add(new THREE.Line(exitGeometry, exitMaterial));

  const grid = new THREE.GridHelper(44, 44, 0xffffff, 0xffffff); // white, so the material color alone sets the tint
  grid.position.y = -4.6;
  const gridMaterial = grid.material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.9;
  world.add(grid);

  // Requests: one instanced mesh, so 84 cubes cost one draw call.
  const packetGeometry = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  geometries.push(packetGeometry);
  const packetMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const packets = new THREE.InstancedMesh(packetGeometry, packetMaterial, PACKETS);
  packets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  world.add(packets);
  // About one request in five is blocked.
  const blocked = Array.from({ length: PACKETS }, (_, i) => spread(i, 0.7548776662) < 0.2);
  const speed = Array.from({ length: PACKETS }, (_, i) => 0.85 + 0.3 * spread(i, 0.41421356));

  const colors = {
    fg: new THREE.Color(),
    muted: new THREE.Color(),
    accent: new THREE.Color(),
    danger: new THREE.Color(),
  };
  function readTheme() {
    colors.fg.setStyle(cssColor('--foreground'));
    colors.muted.setStyle(cssColor('--muted-foreground'));
    colors.accent.setStyle(cssColor('--accent'));
    colors.danger.setStyle(cssColor('--danger'));
    fgMaterial.color.copy(colors.fg);
    accentMaterial.color.copy(colors.accent);
    lineMaterial.color.setStyle(cssColor('--border'));
    exitMaterial.color.copy(colors.accent);
    gridMaterial.color.setStyle(cssColor('--muted'));
  }
  readTheme();

  const dummy = new THREE.Object3D();
  function place(time: number) {
    for (let i = 0; i < PACKETS; i++) {
      const lane = LANES[i % LANES.length] ?? LANES[0];
      const local = ((((time * (speed[i] ?? 1)) / CYCLE_SECONDS + spread(i)) % 1) + 1) % 1;
      let color: ThreeModule.Color;
      let size: number;
      if (local < 0.62) {
        const p = local / 0.62;
        const at = approach(lane, p);
        dummy.position.set(at.x, at.y, at.z);
        size = smoothstep(0, 0.08, p);
        color = colors.fg;
      } else if (blocked[i]) {
        const q = (local - 0.62) / 0.38;
        // Knocked off the gate toward the viewer, then falls away.
        dummy.position.set(-0.6 - 1.2 * q, q - 6 * q * q, 4 * q);
        size = 1.3 * (1 - smoothstep(0.45, 1, q));
        color = colors.danger;
      } else {
        const q = (local - 0.62) / 0.38;
        dummy.position.set(0.7 + (END_X - 0.7) * q, 0, 0);
        size = 1 - smoothstep(0.75, 1, q);
        color = colors.accent;
      }
      dummy.rotation.set(local * 9, local * 7, 0);
      dummy.scale.setScalar(Math.max(size, 0.0001));
      dummy.updateMatrix();
      packets.setMatrixAt(i, dummy.matrix);
      packets.setColorAt(i, color);
    }
    packets.instanceMatrix.needsUpdate = true;
    if (packets.instanceColor) packets.instanceColor.needsUpdate = true;
    // The pupil holds square, then clicks a quarter turn, like a shutter.
    const turn = time / 2.4;
    pupil.rotation.x = (Math.floor(turn) + smoothstep(0.7, 1, turn % 1)) * (Math.PI / 2);
  }

  // Rail labels follow their lane's starting point on screen.
  const labelAnchors = LANES.map((lane) => {
    const at = approach(lane, 0.3);
    return new THREE.Vector3(at.x, at.y + 0.6, at.z);
  });
  const projected = new THREE.Vector3();
  let width = 1;
  let height = 1;
  function placeLabels() {
    labels.forEach((label, i) => {
      const anchor = labelAnchors[i];
      if (anchor === undefined) return;
      projected.copy(anchor).applyMatrix4(world.matrixWorld).project(camera);
      // Kept inside the canvas so a label never hangs off the edge on narrow screens.
      const half = label.offsetWidth / 2 + 4;
      const x = Math.min(Math.max(((projected.x + 1) / 2) * width, half), width - half);
      const y = ((1 - projected.y) / 2) * height;
      label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      label.classList.remove('opacity-0');
    });
  }

  function resize() {
    width = Math.max(host.clientWidth, 1);
    height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height);
    const aspect = width / height;
    const half = aspect < 1 ? halfHeight / aspect : halfHeight;
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
  }

  // Pointer parallax: the scene leans a little toward the cursor.
  const lean = { x: 0, y: 0, targetX: 0, targetY: 0 };
  function onPointer(event: PointerEvent) {
    lean.targetY = (event.clientX / window.innerWidth - 0.5) * 0.35;
    lean.targetX = (event.clientY / window.innerHeight - 0.5) * 0.12;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clock = new THREE.Timer();
  let frame = 0;
  let visible = false;

  function draw(time: number) {
    lean.x += (lean.targetX - lean.x) * 0.05;
    lean.y += (lean.targetY - lean.y) * 0.05;
    world.rotation.set(lean.x, lean.y, 0);
    place(time);
    world.updateMatrixWorld();
    placeLabels();
    renderer.render(scene, camera);
  }
  function tick(timestamp: number) {
    clock.update(timestamp);
    draw(clock.getElapsed());
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (reduced || frame !== 0 || !visible || document.hidden) return;
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  resize();
  draw(2.4);

  const resizeObserver = new ResizeObserver(() => {
    resize();
    if (frame === 0) draw(clock.getElapsed() || 2.4);
  });
  resizeObserver.observe(host);

  // Only animate while on screen and the tab is visible.
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false;
    if (visible) start();
    else stop();
  });
  intersection.observe(host);
  function onVisibility() {
    if (document.hidden) stop();
    else start();
  }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pointermove', onPointer, { passive: true });

  const themeObserver = new MutationObserver(() => {
    readTheme();
    if (frame === 0) draw(clock.getElapsed() || 2.4);
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return () => {
    stop();
    resizeObserver.disconnect();
    intersection.disconnect();
    themeObserver.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pointermove', onPointer);
    for (const geometry of geometries) geometry.dispose();
    for (const material of [fgMaterial, accentMaterial, lineMaterial, exitMaterial, packetMaterial, gridMaterial]) {
      material.dispose();
    }
    grid.geometry.dispose();
    packets.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}

const RAIL_LABELS = ['model calls', 'card swipes', 'stablecoins'];

/** The hero's 3D scene. three.js loads after the page, so it never holds up first paint. */
export function HeroScene({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<HTMLSpanElement[]>([]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void import('three').then((THREE) => {
      if (cancelled) return;
      try {
        cleanup = mount(THREE, host, labelRefs.current);
      } catch {
        // No WebGL (old device, or disabled): the hero still reads fine without the scene.
        host.classList.add('hidden');
      }
    });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className={className} aria-hidden="true">
      <div ref={hostRef} className="absolute inset-0" />
      {RAIL_LABELS.map((label, i) => (
        <span
          key={label}
          ref={(node) => {
            if (node !== null) labelRefs.current[i] = node;
          }}
          className="pointer-events-none absolute left-0 top-0 whitespace-nowrap border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground opacity-0 transition-opacity duration-700"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
