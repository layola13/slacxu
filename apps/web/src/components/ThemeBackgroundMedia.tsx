import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import type { ThemeBackgroundScene, ThemeVisualTuning } from "../theme";
import { addPerformancePressureListener, prefersReducedMotion } from "../performance/animationBudget";

type Props = {
  imageUrl?: string;
  videoUrl?: string;
  scene?: ThemeBackgroundScene;
  tuning: ThemeVisualTuning;
};

export function ThemeBackgroundMedia({ imageUrl, videoUrl, scene, tuning }: Props) {
  const renderAnimatedBackdrop = false;
  return (
    <Box data-testid="theme-background-media" sx={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      {imageUrl && (
        <Box
          data-testid="theme-background-image"
          sx={{
            position: "absolute",
            inset: 0,
            opacity: tuning.backgroundLayerOpacity,
            backgroundImage: `url("${imageUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center"
          }}
        />
      )}
      {videoUrl && <BackgroundVideo src={videoUrl} opacity={tuning.backgroundLayerOpacity} />}
      {renderAnimatedBackdrop && scene?.renderer === "canvas" && <CanvasBackgroundScene scene={scene} />}
    </Box>
  );
}

function BackgroundVideo({ src, opacity }: { src: string; opacity: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let pressured = false;
    const updatePlayback = () => {
      const video = videoRef.current;
      if (!video) return;
      if (pressured || document.visibilityState !== "visible" || !document.hasFocus() || prefersReducedMotion()) {
        video.pause();
      } else {
        void video.play().catch(() => undefined);
      }
    };
    const removePressureListener = addPerformancePressureListener((next) => {
      pressured = next;
      updatePlayback();
    });
    document.addEventListener("visibilitychange", updatePlayback);
    window.addEventListener("focus", updatePlayback);
    window.addEventListener("blur", updatePlayback);
    updatePlayback();
    return () => {
      document.removeEventListener("visibilitychange", updatePlayback);
      window.removeEventListener("focus", updatePlayback);
      window.removeEventListener("blur", updatePlayback);
      removePressureListener();
    };
  }, [src]);

  return (
    <Box
      ref={videoRef}
      component="video"
      data-testid="theme-background-video"
      src={src}
      autoPlay
      muted
      loop
      playsInline
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity }}
    />
  );
}

function CanvasBackgroundScene({ scene }: { scene: ThemeBackgroundScene }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    let animationId = 0;
    let pressured = false;
    let width = 1;
    let height = 1;
    const speed = clampNumber(scene.speed, 0.6, 0.1, 3);
    const density = clampNumber(scene.density, 0.55, 0.1, 1);
    const primary = scene.color ?? "#D94F75";
    const secondary = scene.secondaryColor ?? "#F8B4C4";

    const resize = () => {
      width = Math.max(1, canvas.clientWidth);
      height = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(width * Math.min(window.devicePixelRatio, 2));
      canvas.height = Math.round(height * Math.min(window.devicePixelRatio, 2));
      context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    const animate = (time: number) => {
      if (pressured) return;
      const t = time * 0.00018 * speed;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = clampNumber(scene.opacity, 0.54, 0, 1);
      if (scene.preset === "particles") {
        drawParticles(context, width, height, t, density, primary, secondary);
      } else {
        drawAurora(context, width, height, t, primary, secondary);
      }
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
    };
  }, [scene]);

  return <Box component="canvas" ref={canvasRef} data-testid="theme-background-canvas" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

function drawAurora(context: CanvasRenderingContext2D, width: number, height: number, time: number, primary: string, secondary: string) {
  for (let band = 0; band < 4; band += 1) {
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, band % 2 === 0 ? primary : secondary);
    gradient.addColorStop(1, band % 2 === 0 ? secondary : primary);
    context.strokeStyle = gradient;
    context.lineWidth = 72 - band * 9;
    context.beginPath();
    for (let x = -80; x <= width + 80; x += 28) {
      const y = height * (0.24 + band * 0.13) + Math.sin(x * 0.007 + time + band) * 48 + Math.cos(x * 0.012 - time * 0.8) * 18;
      if (x === -80) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  }
}

function drawParticles(context: CanvasRenderingContext2D, width: number, height: number, time: number, density: number, primary: string, secondary: string) {
  const count = Math.round(24 + density * 90);
  for (let index = 0; index < count; index += 1) {
    const angle = index * 12.9898;
    const x = ((Math.sin(angle) * 43758.5453 + time * 48) % 1) * width;
    const y = ((Math.cos(angle * 0.73) * 24634.6345 + time * 26) % 1) * height;
    const size = 1.5 + (index % 5) * 0.8;
    context.fillStyle = index % 2 === 0 ? primary : secondary;
    context.beginPath();
    context.arc((x + width) % width, (y + height) % height, size, 0, Math.PI * 2);
    context.fill();
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numberValue));
}
