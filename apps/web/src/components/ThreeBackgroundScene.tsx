import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import * as THREE from "three";
import type { ThemeBackgroundScene } from "../theme";
import { addPerformancePressureListener, prefersReducedMotion } from "../performance/animationBudget";

export function ThreeBackgroundScene({ scene }: { scene: ThemeBackgroundScene }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.append(renderer.domElement);

    const threeScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5.2);
    const primary = new THREE.Color(scene.color ?? "#D94F75");
    const secondary = new THREE.Color(scene.secondaryColor ?? "#F8B4C4");
    const density = clampNumber(scene.density, 0.58, 0.1, 1);
    const speed = clampNumber(scene.speed, 0.65, 0.1, 3);
    const group = new THREE.Group();
    threeScene.add(group);
    threeScene.add(new THREE.AmbientLight("#ffffff", 1.4));
    const light = new THREE.PointLight(primary, 2.8, 10);
    light.position.set(2.5, 1.8, 3.5);
    threeScene.add(light);

    const count = Math.round(18 + density * 46);
    const geometry = scene.preset === "orbit" ? new THREE.IcosahedronGeometry(0.08, 1) : new THREE.SphereGeometry(0.055, 14, 14);
    const material = new THREE.MeshStandardMaterial({
      color: primary,
      emissive: secondary,
      emissiveIntensity: 0.22,
      roughness: 0.38,
      metalness: 0.14,
      transparent: true,
      opacity: clampNumber(scene.opacity, 0.62, 0, 1)
    });
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(geometry, material);
      const angle = (index / count) * Math.PI * 2;
      const radius = 1.2 + (index % 7) * 0.28;
      mesh.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.9, Math.sin(angle) * radius * 0.36);
      mesh.scale.setScalar(1 + (index % 5) * 0.36);
      group.add(mesh);
    }

    let animationId = 0;
    let pressured = false;
    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    const animate = (time: number) => {
      if (pressured) return;
      const t = time * 0.00016 * speed;
      group.rotation.y = t;
      group.rotation.x = Math.sin(t * 0.7) * 0.18;
      renderer.render(threeScene, camera);
      animationId = requestAnimationFrame(animate);
    };
    const renderLoop = () => {
      cancelAnimationFrame(animationId);
      animationId = 0;
      if (!pressured && !prefersReducedMotion() && document.visibilityState === "visible" && document.hasFocus()) {
        animationId = requestAnimationFrame(animate);
      }
    };
    const onVisibilityChange = () => renderLoop();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onVisibilityChange);
    window.addEventListener("blur", onVisibilityChange);
    const removePressureListener = addPerformancePressureListener((next) => {
      pressured = next;
      renderLoop();
    });
    if (prefersReducedMotion()) {
      animate(0);
      cancelAnimationFrame(animationId);
    } else if (!pressured) {
      renderLoop();
    }

    return () => {
      cancelAnimationFrame(animationId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onVisibilityChange);
      window.removeEventListener("blur", onVisibilityChange);
      removePressureListener();
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [scene]);

  return <Box ref={mountRef} data-testid="theme-background-three" sx={{ position: "absolute", inset: 0, opacity: clampNumber(scene.opacity, 0.62, 0, 1) }} />;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}
