import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as THREE from 'three';

function createGlowTexture(inner = 'rgba(255,255,255,1)', mid = 'rgba(94,234,212,0.9)') {
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

const ConciergeOrb = forwardRef(function ConciergeOrb({ active, size = 48 }, ref) {
  const mountRef = useRef(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  // Impulse energy driven by external pulse() calls (per character / per sentence),
  // decays each frame, layered on top of the base idle/active animation.
  const impulseRef = useRef(0);
  const flareRef = useRef(0); // brief bright flash on sentence-start pulses

  useImperativeHandle(ref, () => ({
    pulse(strength = 0.35) {
      impulseRef.current = Math.min(impulseRef.current + strength, 2.2);
    },
    flare(strength = 1) {
      flareRef.current = Math.min(flareRef.current + strength, 1.6);
      impulseRef.current = Math.min(impulseRef.current + strength * 0.8, 2.2);
    },
  }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || size;
    const height = mount.clientHeight || size;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.z = 3.1;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    // --- Main orb shell particles ---
    const particleCount = 380;
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
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      basePositions[i * 3] = x;
      basePositions[i * 3 + 1] = y;
      basePositions[i * 3 + 2] = z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const texture = createGlowTexture();
    const material = new THREE.PointsMaterial({
      size: 0.1,
      map: texture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color('#2dd4bf'),
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    // --- Sparse outer "stardust" field for depth ---
    const dustCount = 90;
    const dustPositions = new Float32Array(dustCount * 3);
    const dustBase = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      const r = 1.5 + Math.random() * 0.9;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);
      dustPositions[i * 3] = x;
      dustPositions[i * 3 + 1] = y;
      dustPositions[i * 3 + 2] = z;
      dustBase[i * 3] = x;
      dustBase[i * 3 + 1] = y;
      dustBase[i * 3 + 2] = z;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustTexture = createGlowTexture('rgba(255,255,255,0.9)', 'rgba(167,139,250,0.7)');
    const dustMat = new THREE.PointsMaterial({
      size: 0.06,
      map: dustTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color('#a78bfa'),
      opacity: 0.6,
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    // --- Glowing core ---
    const coreGeo = new THREE.IcosahedronGeometry(0.32, 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // --- Flare ring (brief burst on sentence-start pulses) ---
    const flareGeo = new THREE.RingGeometry(0.5, 0.52, 48);
    const flareMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#5eead4'),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const flare = new THREE.Mesh(flareGeo, flareMat);
    scene.add(flare);

    let frameId;
    const t0 = performance.now();
    const baseHue = 0.49; // teal

    function animate() {
      const elapsed = (performance.now() - t0) / 1000;
      const isActive = activeRef.current;

      // Decay impulse/flare energy each frame
      impulseRef.current *= 0.9;
      flareRef.current *= 0.86;
      const impulse = impulseRef.current;
      const flareEnergy = flareRef.current;

      const amp = (isActive ? 0.2 : 0.06) + impulse * 0.18;
      const speed = (isActive ? 1.9 : 0.5) + impulse * 1.5;

      const posAttr = geometry.attributes.position;
      for (let i = 0; i < particleCount; i++) {
        const bx = basePositions[i * 3];
        const by = basePositions[i * 3 + 1];
        const bz = basePositions[i * 3 + 2];
        const n = Math.sin(elapsed * speed + i * 0.35) * amp;
        const push = 1 + n * 0.5 + impulse * 0.06;
        posAttr.array[i * 3] = bx * push;
        posAttr.array[i * 3 + 1] = by * push;
        posAttr.array[i * 3 + 2] = bz + n * 0.15;
      }
      posAttr.needsUpdate = true;

      const dustAttr = dustGeo.attributes.position;
      for (let i = 0; i < dustCount; i++) {
        const bx = dustBase[i * 3];
        const by = dustBase[i * 3 + 1];
        const bz = dustBase[i * 3 + 2];
        const n = Math.sin(elapsed * 0.3 + i) * 0.1;
        dustAttr.array[i * 3] = bx * (1 + n);
        dustAttr.array[i * 3 + 1] = by * (1 + n);
        dustAttr.array[i * 3 + 2] = bz * (1 + n);
      }
      dustAttr.needsUpdate = true;
      dust.rotation.y = elapsed * 0.08;

      points.rotation.y = elapsed * (isActive ? 0.55 : 0.15) + impulse * 0.02;
      points.rotation.x = Math.sin(elapsed * 0.2) * 0.15;

      // Slow hue drift while active, settles back to teal when idle
      const hue = isActive ? (baseHue + Math.sin(elapsed * 0.25) * 0.05 + impulse * 0.02) : baseHue;
      material.color.setHSL(hue, 0.75, 0.6);

      core.rotation.y = -elapsed * 0.3;
      const corePulse = 1 + Math.sin(elapsed * (isActive ? 4.2 : 1.4)) * (isActive ? 0.14 : 0.04) + impulse * 0.22;
      core.scale.setScalar(corePulse);
      coreMat.opacity = 0.32 + impulse * 0.25;

      material.size = 0.1 + (isActive ? Math.sin(elapsed * 6) * 0.02 : 0) + impulse * 0.03;

      // Flare ring: expands and fades on each burst
      if (flareEnergy > 0.01) {
        flare.visible = true;
        const flareScale = 1 + (1 - flareEnergy) * 1.8;
        flare.scale.setScalar(flareScale);
        flareMat.opacity = flareEnergy * 0.6;
      } else {
        flare.visible = false;
      }

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    }
    animate();

    function handleResize() {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      dustTexture.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      flareGeo.dispose();
      flareMat.dispose();
      renderer.dispose();
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} style={{ width: size, height: size }} />;
});

export default ConciergeOrb;
