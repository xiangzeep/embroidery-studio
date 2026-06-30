"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { StitchPattern } from "@/lib/pipeline/types";

type Props = { pattern: StitchPattern };

export function StitchPreview3D({ pattern }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf5f3ef);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    const distance = Math.max(pattern.widthMm, pattern.heightMm) * 1.4;
    camera.position.set(0, -distance * 0.6, distance);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(pattern.widthMm * 1.2, pattern.heightMm * 1.2),
      new THREE.MeshStandardMaterial({
        color: 0xeeeae0,
        roughness: 0.95,
        metalness: 0.0,
      }),
    );
    scene.add(fabric);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight.position.set(40, 40, 80);
    scene.add(dirLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    const meshes: THREE.Mesh[] = [];

    const flushTube = (pts: THREE.Vector3[], rgb: [number, number, number]) => {
      if (pts.length < 2) {
        pts.length = 0;
        return;
      }
      try {
        const curve = new THREE.CatmullRomCurve3(pts.slice(), false, "centripetal");
        const segments = Math.min(pts.length * 4, 4000);
        const geom = new THREE.TubeGeometry(curve, segments, 0.22, 6, false);
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255),
          roughness: 0.55,
          metalness: 0.0,
        });
        const mesh = new THREE.Mesh(geom, mat);
        scene.add(mesh);
        meshes.push(mesh);
      } catch (e) {
        console.warn("TubeGeometry skipped", e);
      }
      pts.length = 0;
    };

    for (const block of pattern.blocks) {
      const pts: THREE.Vector3[] = [];
      for (const s of block.stitches) {
        if (s.kind === "jump" || s.kind === "trim" || s.kind === "stop") {
          flushTube(pts, block.rgb);
          continue;
        }
        pts.push(
          new THREE.Vector3(
            s.x - pattern.widthMm / 2,
            -(s.y - pattern.heightMm / 2),
            0.35,
          ),
        );
      }
      flushTube(pts, block.rgb);
    }

    let raf = 0;
    const render = () => {
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    render();

    let dragging = false;
    let lx = 0;
    let ly = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      renderer.domElement.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = (e.clientX - lx) * 0.005;
      const dy = (e.clientY - ly) * 0.005;
      lx = e.clientX;
      ly = e.clientY;
      const sph = new THREE.Spherical().setFromVector3(camera.position);
      sph.theta -= dx;
      sph.phi = Math.max(0.1, Math.min(Math.PI - 0.1, sph.phi - dy));
      camera.position.setFromSpherical(sph);
      camera.lookAt(0, 0, 0);
    };
    const onUp = () => {
      dragging = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scale = 1 + e.deltaY * 0.001;
      camera.position.multiplyScalar(scale);
    };

    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const onResize = () => {
      const nw = el.clientWidth || 600;
      const nh = el.clientHeight || 480;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      for (const m of meshes) {
        m.geometry.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else (mat as THREE.Material).dispose();
      }
      fabric.geometry.dispose();
      (fabric.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [pattern]);

  return <div ref={mountRef} className="size-full min-h-[400px]" />;
}
