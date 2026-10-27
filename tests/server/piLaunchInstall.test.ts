import { describe, expect, test } from "bun:test";
import { getSpec, detectAdapter } from "../../apps/server/src/launchInstall.ts";
import { getAgentEngine, isAgentEngineId, AGENT_RUNTIME_BRIDGE_PLAN } from "@codex-ui/shared";

describe("piLaunchInstall and agentEngines catalog", () => {
  test("spec exists and has expected properties", () => {
    const spec = getSpec("pi-launch");
    expect(spec).toBeDefined();
    expect(spec?.id).toBe("pi-launch");
    expect(spec?.repo).toBe("pi");
    expect(spec?.cloneUrl).toBeNull();
    expect(spec?.envPrefix).toBe("PI_LAUNCH_");
    expect(spec?.configDirName).toBe("pi-launch");
    expect(spec?.productBins).toContain("pi");
  });

  test("detectAdapter detects pi-launch from E:/projects/pi", () => {
    const spec = getSpec("pi-launch")!;
    const status = detectAdapter(spec);
    expect(status.id).toBe("pi-launch");
    expect(status.installed).toBe(true);
    expect(status.sourcePresent).toBe(true);
    expect(status.productCliPresent).toBe(true);
    expect(typeof status.productCliPath).toBe("string");
    expect(status.productCliPath!.length).toBeGreaterThan(0);
  });

  test("agentEngine catalog includes pi definition", () => {
    expect(isAgentEngineId("pi")).toBe(true);
    const engine = getAgentEngine("pi");
    expect(engine.id).toBe("pi");
    expect(engine.label).toBe("Pi");
    expect(engine.launchId).toBe("pi-launch");
    expect(engine.protocol).toBe("pi_rpc");
    expect(engine.capabilities.chatRuntime).toBe(false);
  });

  test("agent runtime bridge plan includes pi", () => {
    const plan = AGENT_RUNTIME_BRIDGE_PLAN.find((p) => p.engine === "pi");
    expect(plan).toBeDefined();
    expect(plan?.launchEnvPrefix).toBe("PI_LAUNCH_");
    expect(plan?.startMode).toBe("cli_subprocess");
  });
});
