import { expect, test } from "bun:test";
import {
  LOW_FPS_REPORT_COOLDOWN_MS,
  LOW_FPS_RECOVERY_REQUIRED_SAMPLES,
  createLowFpsState,
  evaluateLowFpsSample
} from "../../apps/web/src/performance/lowFpsDiagnostics";
import { isPerformancePressured, setPerformancePressureSource } from "../../apps/web/src/performance/animationBudget";

test("reports only after three consecutive visible samples below 10 FPS", () => {
  let state = createLowFpsState();
  for (const [index, fps] of [9, 8, 7].entries()) {
    const result = evaluateLowFpsSample(state, { fps, now: index * 1_000, visible: true });
    state = result.state;
    expect(result.shouldReport).toBe(index === 2);
  }
});

test("normal FPS and hidden pages reset the low-FPS streak", () => {
  let state = evaluateLowFpsSample(createLowFpsState(), { fps: 4, now: 0, visible: true }).state;
  state = evaluateLowFpsSample(state, { fps: 60, now: 1_000, visible: true }).state;
  expect(state.consecutiveLowSamples).toBe(0);
  state = evaluateLowFpsSample(state, { fps: 3, now: 2_000, visible: true }).state;
  state = evaluateLowFpsSample(state, { fps: 3, now: 3_000, visible: false }).state;
  expect(state.consecutiveLowSamples).toBe(0);
});

test("pressure remains active until five consecutive samples recover above 24 FPS", () => {
  let state = createLowFpsState();
  for (const [index, fps] of [5, 6, 7].entries()) {
    state = evaluateLowFpsSample(state, { fps, now: index * 1_000, visible: true }).state;
  }
  expect(state.pressured).toBe(true);

  for (let index = 0; index < LOW_FPS_RECOVERY_REQUIRED_SAMPLES - 1; index += 1) {
    state = evaluateLowFpsSample(state, { fps: 60, now: 4_000 + index * 1_000, visible: true }).state;
    expect(state.pressured).toBe(true);
  }
  state = evaluateLowFpsSample(state, { fps: 60, now: 10_000, visible: true }).state;
  expect(state.pressured).toBe(false);
});

test("a marginal FPS sample does not restart expensive animation while pressured", () => {
  let state = createLowFpsState();
  for (const fps of [3, 4, 5]) {
    state = evaluateLowFpsSample(state, { fps, now: 1_000, visible: true }).state;
  }
  state = evaluateLowFpsSample(state, { fps: 12, now: 2_000, visible: true }).state;
  expect(state.pressured).toBe(true);
  expect(state.consecutiveRecoverySamples).toBe(0);
});

test("persistent low FPS is rate-limited to one report per minute", () => {
  let state = createLowFpsState();
  for (let index = 0; index < 3; index += 1) {
    state = evaluateLowFpsSample(state, { fps: 2, now: index * 1_000, visible: true }).state;
  }
  const withinCooldown = evaluateLowFpsSample(state, { fps: 2, now: LOW_FPS_REPORT_COOLDOWN_MS, visible: true });
  expect(withinCooldown.shouldReport).toBe(false);
  const afterCooldown = evaluateLowFpsSample(withinCooldown.state, {
    fps: 2,
    now: LOW_FPS_REPORT_COOLDOWN_MS + 2_000,
    visible: true
  });
  expect(afterCooldown.shouldReport).toBe(true);
});

test("independent pressure sources cannot clear each other", () => {
  setPerformancePressureSource("fps-test", true);
  setPerformancePressureSource("window-test", true);
  setPerformancePressureSource("fps-test", false);
  expect(isPerformancePressured()).toBe(true);
  setPerformancePressureSource("window-test", false);
  expect(isPerformancePressured()).toBe(false);
});
