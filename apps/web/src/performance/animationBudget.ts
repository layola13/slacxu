export const PERFORMANCE_PRESSURE_EVENT = "codex-ultra:performance-pressure";

export type PerformancePressureDetail = { pressured: boolean };

let performancePressured = false;
const pressureSources = new Map<string, boolean>();

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export function addPerformancePressureListener(listener: (pressured: boolean) => void): () => void {
  if (typeof window === "undefined") {
    listener(performancePressured);
    return () => {};
  }
  const handler = (event: Event) => {
    listener(Boolean((event as CustomEvent<PerformancePressureDetail>).detail?.pressured));
  };
  window.addEventListener(PERFORMANCE_PRESSURE_EVENT, handler);
  listener(performancePressured);
  return () => window.removeEventListener(PERFORMANCE_PRESSURE_EVENT, handler);
}

export function announcePerformancePressure(pressured: boolean): void {
  setPerformancePressureSource("fps", pressured);
}

export function setPerformancePressureSource(source: string, pressured: boolean): void {
  if (pressured) pressureSources.set(source, true);
  else pressureSources.delete(source);
  const next = pressureSources.size > 0;
  if (performancePressured === next) return;
  performancePressured = next;
  if (typeof document === "undefined" || typeof window === "undefined") return;
  document.documentElement.dataset.performancePressure = String(next);
  window.dispatchEvent(new CustomEvent<PerformancePressureDetail>(PERFORMANCE_PRESSURE_EVENT, { detail: { pressured: next } }));
}

export function isPerformancePressured(): boolean {
  return performancePressured;
}
