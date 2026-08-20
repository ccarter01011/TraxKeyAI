// Shared vanilla-JS particle orb for every TraxKey marketing-site chat/concierge
// surface. Same visual as the TraxKey app's React ConciergeOrb.jsx and
// TraxSail's concierge-orb.js: a glowing particle sphere, plain CSS orbs
// were the old version. Dynamically import THREE and this module together:
// const [THREE, { createOrb }] = await Promise.all([...]).

function createGlowTexture(THREE, inner, mid) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, mid);
  gradient.addColorStop(1, 'rgba(45,212,191,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// Returns { pulse(strength), flare(strength), setActive(bool), destroy() }
export function createOrb(THREE, mount, size) {
  const width = mount.clientWidth || size;
  const height = mount.clientHeight || size;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.z = 3.1;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  mount.appendChild(renderer.domElement);

  const particleCount = 260;
  const positions = new Float32Array(particleCount * 3);
  const basePositions = new Float32Array(particleCount * 3);
  const radius = 1.05;

  for (let i = 0; i < particleCount; i++) {
    const t = i / particleCount;
    const phi = Math.acos(1 - 2 * t);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = radius * (0.82 + Math.random() * 0.32);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    basePositions[i * 3] = x; basePositions[i * 3 + 1] = y; basePositions[i * 3 + 2] = z;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const texture = createGlowTexture(THREE, 'rgba(255,255,255,1)', 'rgba(94,234,212,0.9)');
  const material = new THREE.PointsMaterial({
    size: 0.1, map: texture, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: new THREE.Color('#2dd4bf'),
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);

  const coreGeo = new THREE.IcosahedronGeometry(0.32, 2);
  const coreMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#38bdf8'), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);

  const flareGeo = new THREE.RingGeometry(0.5, 0.52, 40);
  const flareMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#5eead4'), transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const flare = new THREE.Mesh(flareGeo, flareMat);
  scene.add(flare);

  let impulse = 0;
  let flareEnergy = 0;
  let active = true;
  let frameId;
  const t0 = performance.now();
  const baseHue = 0.49;

  function animate() {
    const elapsed = (performance.now() - t0) / 1000;
    impulse *= 0.9;
    flareEnergy *= 0.86;

    const amp = (active ? 0.2 : 0.06) + impulse * 0.18;
    const speed = (active ? 1.9 : 0.5) + impulse * 1.5;

    const posAttr = geometry.attributes.position;
    for (let i = 0; i < particleCount; i++) {
      const bx = basePositions[i * 3], by = basePositions[i * 3 + 1], bz = basePositions[i * 3 + 2];
      const n = Math.sin(elapsed * speed + i * 0.35) * amp;
      const push = 1 + n * 0.5 + impulse * 0.06;
      posAttr.array[i * 3] = bx * push;
      posAttr.array[i * 3 + 1] = by * push;
      posAttr.array[i * 3 + 2] = bz + n * 0.15;
    }
    posAttr.needsUpdate = true;

    points.rotation.y = elapsed * (active ? 0.55 : 0.15) + impulse * 0.02;
    points.rotation.x = Math.sin(elapsed * 0.2) * 0.15;

    const hue = active ? (baseHue + Math.sin(elapsed * 0.25) * 0.05 + impulse * 0.02) : baseHue;
    material.color.setHSL(hue, 0.75, 0.6);

    core.rotation.y = -elapsed * 0.3;
    const corePulse = 1 + Math.sin(elapsed * (active ? 4.2 : 1.4)) * (active ? 0.14 : 0.04) + impulse * 0.22;
    core.scale.setScalar(corePulse);
    coreMat.opacity = 0.32 + impulse * 0.25;
    material.size = 0.1 + (active ? Math.sin(elapsed * 6) * 0.02 : 0) + impulse * 0.03;

    if (flareEnergy > 0.01) {
      flare.visible = true;
      flare.scale.setScalar(1 + (1 - flareEnergy) * 1.8);
      flareMat.opacity = flareEnergy * 0.6;
    } else {
      flare.visible = false;
    }

    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }
  animate();

  function handleResize() {
    const w = mount.clientWidth, h = mount.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', handleResize);

  return {
    pulse(strength = 0.3) { impulse = Math.min(impulse + strength, 2.2); },
    flare(strength = 1) { flareEnergy = Math.min(flareEnergy + strength, 1.6); impulse = Math.min(impulse + strength * 0.8, 2.2); },
    setActive(v) { active = v; },
    destroy() {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      geometry.dispose(); material.dispose(); texture.dispose();
      coreGeo.dispose(); coreMat.dispose(); flareGeo.dispose(); flareMat.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    },
  };
}
