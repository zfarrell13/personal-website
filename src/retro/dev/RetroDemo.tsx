'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RetroRenderer } from '@/retro/RetroRenderer';
import { retroMaterial } from '@/retro/retroMaterial';

declare global {
  interface Window {
    __retroFrames?: number;
  }
}

export default function RetroDemo() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const retro = new RetroRenderer(canvas);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1b2a6b');
    scene.fog = new THREE.Fog('#1b2a6b', 6, 22);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 1.5, 7);
    scene.add(new THREE.HemisphereLight('#bcd4ff', '#3b2a1a', 1.2));
    const sun = new THREE.DirectionalLight('#ffe2b0', 2);
    sun.position.set(3, 5, 2);
    scene.add(sun);

    const colors = ['#ff8a3d', '#2ec4b6', '#f7f052'];
    const geometries = [
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.TorusKnotGeometry(0.7, 0.25, 48, 6),
      new THREE.OctahedronGeometry(1, 0),
    ];
    const meshes = geometries.map((g, i) => {
      const m = new THREE.Mesh(g, retroMaterial(new THREE.MeshLambertMaterial({ color: colors[i], flatShading: true })));
      m.position.x = (i - 1) * 2.6;
      scene.add(m);
      return m;
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40, 20, 20),
      retroMaterial(new THREE.MeshLambertMaterial({ color: '#0f5e6e' })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1.5;
    scene.add(floor);

    const resize = () => {
      retro.setSize(canvas.clientWidth, canvas.clientHeight);
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    window.__retroFrames = 0;
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      const t = (performance.now() - t0) / 1000;
      meshes.forEach((m, i) => {
        m.rotation.x = t * (0.4 + i * 0.1);
        m.rotation.y = t * 0.7;
      });
      retro.render(scene, camera);
      window.__retroFrames = (window.__retroFrames ?? 0) + 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      retro.dispose();
    };
  }, []);

  return <canvas ref={ref} className="retro-canvas" />;
}
