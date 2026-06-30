"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { StitchPattern } from "@/lib/pipeline/types";
import {
  buildThreadSegments,
  getOrthographicView,
  PREVIEW_3D_FABRIC_HEX,
  PREVIEW_3D_SCENE_BACKGROUND_HEX,
  rgbToHex,
  type ThreadSegment,
} from "./stitch-preview-3d-helpers";

type Props = { pattern: StitchPattern };

export function StitchPreview3D({ pattern }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    setPreviewError(null);
    const w = el.clientWidth || 600;
    const h = el.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(PREVIEW_3D_SCENE_BACKGROUND_HEX);

    const view = getOrthographicView(pattern.widthMm, pattern.heightMm, w / h);
    const camera = new THREE.OrthographicCamera(
      -view.width / 2,
      view.width / 2,
      view.height / 2,
      -view.height / 2,
      0.1,
      5000,
    );
    const distance = Math.max(pattern.widthMm, pattern.heightMm, 1) * 2.2;
    camera.position.set(0, -distance * 0.18, distance);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setPreviewError("3D preview is unavailable on this device or browser.");
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const fabric = new THREE.Mesh(
      new THREE.PlaneGeometry(pattern.widthMm * 1.12, pattern.heightMm * 1.12),
      new THREE.MeshBasicMaterial({
        color: PREVIEW_3D_FABRIC_HEX,
        side: THREE.DoubleSide,
      }),
    );
    scene.add(fabric);

    const meshes: THREE.Mesh[] = [];
    const segmentsByColor = groupSegmentsByColor(buildThreadSegments(pattern));
    let colorLayer = 0;
    for (const [key, segments] of segmentsByColor) {
      const rgb = key.split(",").map(Number) as [number, number, number];
      const geom = buildRibbonGeometry(segments, 0.38, 0.38 + colorLayer * 0.012);
      const mat = new THREE.MeshBasicMaterial({
        color: rgbToHex(rgb),
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, mat);
      scene.add(mesh);
      meshes.push(mesh);
      colorLayer += 1;
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
      const nextView = getOrthographicView(pattern.widthMm, pattern.heightMm, nw / nh);
      camera.left = -nextView.width / 2;
      camera.right = nextView.width / 2;
      camera.top = nextView.height / 2;
      camera.bottom = -nextView.height / 2;
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

  return (
    <div className="size-full min-h-[400px]">
      {previewError ? (
        <div className="flex size-full min-h-[400px] items-center justify-center rounded-xl border border-neutral-200 bg-[#f5f3ef] px-6 text-center text-sm text-neutral-600">
          {previewError}
        </div>
      ) : (
        <div ref={mountRef} className="size-full min-h-[400px]" />
      )}
    </div>
  );
}

function groupSegmentsByColor(segments: ThreadSegment[]): Map<string, ThreadSegment[]> {
  const grouped = new Map<string, ThreadSegment[]>();
  for (const segment of segments) {
    const key = segment.rgb.join(",");
    const existing = grouped.get(key);
    if (existing) existing.push(segment);
    else grouped.set(key, [segment]);
  }
  return grouped;
}

function buildRibbonGeometry(
  segments: ThreadSegment[],
  widthMm: number,
  zMm: number,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const halfWidth = widthMm / 2;

  for (const segment of segments) {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;

    const px = (-dy / len) * halfWidth;
    const py = (dx / len) * halfWidth;
    const base = vertices.length / 3;

    vertices.push(
      segment.from.x - px,
      segment.from.y - py,
      zMm,
      segment.from.x + px,
      segment.from.y + py,
      zMm,
      segment.to.x + px,
      segment.to.y + py,
      zMm,
      segment.to.x - px,
      segment.to.y - py,
      zMm,
    );
    normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
