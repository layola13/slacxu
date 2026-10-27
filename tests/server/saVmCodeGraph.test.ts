import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractFileInfo,
  buildScopedCodeGraph,
  formatAsDot,
  formatAsPyStub,
  formatAsNetworkX,
  nativeCodeGraph,
} from "../../apps/server/src/saVmCodeGraph";
import { normalizeSaVmPolicy } from "../../backends/vmtool-security/src/security/saVmPolicy";

describe("saVmCodeGraph", () => {
  test("extracts TypeScript class inheritance, interfaces, and owned members", async () => {
    const tsCode = `
      export class Animal {
        name: string;
      }
      export interface Flyable {
        fly(): void;
      }
      export class Bird extends Animal implements Flyable {
        private wing: Wing;
        fly() {}
      }
    `;
    const info = await extractFileInfo("test.ts", tsCode);
    expect(info.classes.length).toBe(3);

    const bird = info.classes.find((c) => c.name === "Bird");
    expect(bird).toBeDefined();
    expect(bird?.bases).toEqual(["Animal"]);
    expect(bird?.interfaces).toEqual(["Flyable"]);
    expect(bird?.fields).toContainEqual({ name: "wing", type: "Wing" });
  });

  test("extracts Python class inheritance", async () => {
    const pyCode = `
class LivingThing:
    pass

class Dog(LivingThing):
    owner: Person
    def bark(self):
        pass
    `;
    const info = await extractFileInfo("test.py", pyCode);
    expect(info.classes.length).toBe(2);

    const dog = info.classes.find((c) => c.name === "Dog");
    expect(dog).toBeDefined();
    expect(dog?.bases).toEqual(["LivingThing"]);
  });

  test("extracts TypeScript imports accurately", async () => {
    const tsCode = `
      import { A, B as C } from "./foo.js";
      import DefaultX from "./bar.js";
      import * as AllZ from "./baz.js";
    `;
    const info = await extractFileInfo("index.ts", tsCode);
    expect(info.imports.length).toBe(3);
    expect(info.imports[0]?.specifier).toBe("./foo.js");
    expect(info.imports[0]?.symbols).toContainEqual({ imported: "A", local: "A" });
    expect(info.imports[0]?.symbols).toContainEqual({ imported: "B", local: "C" });
    expect(info.imports[1]?.isDefault).toBe(true);
    expect(info.imports[2]?.isNamespace).toBe(true);
  });

  test("buildScopedCodeGraph traverses inheritance and formats as Graphviz DOT", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codegraph-test-"));
    try {
      const baseTs = `
        export class BaseEngine {
          start() {}
        }
      `;
      const derivedTs = `
        import { BaseEngine } from "./base.js";
        export interface IRunner { run(): void; }
        export class CustomEngine extends BaseEngine implements IRunner {
          private workerHelper: WorkerHelper;
          run() {}
        }
      `;
      writeFileSync(join(tempDir, "base.ts"), baseTs, "utf8");
      writeFileSync(join(tempDir, "derived.ts"), derivedTs, "utf8");

      const policy = normalizeSaVmPolicy(undefined, tempDir);
      const graph = await buildScopedCodeGraph(
        {
          target: "CustomEngine",
          mode: "symbol_hierarchy",
          depth: 2,
          candidate_files: [join(tempDir, "derived.ts"), join(tempDir, "base.ts")],
        },
        policy,
        tempDir
      );

      expect(graph.rootId).toBe("CustomEngine");
      expect(graph.nodes.some((n) => n.id === "CustomEngine")).toBe(true);
      expect(graph.nodes.some((n) => n.id === "BaseEngine")).toBe(true);
      expect(graph.nodes.some((n) => n.id === "IRunner")).toBe(true);
      expect(graph.nodes.some((n) => n.id === "WorkerHelper")).toBe(true);

      expect(graph.edges).toContainEqual({
        source: "CustomEngine",
        target: "BaseEngine",
        kind: "extends",
        label: "extends",
      });
      expect(graph.edges).toContainEqual({
        source: "CustomEngine",
        target: "IRunner",
        kind: "implements",
        label: "impl",
      });
      expect(graph.edges).toContainEqual({
        source: "CustomEngine",
        target: "WorkerHelper",
        kind: "owns",
        label: "owns",
      });

      // Formatter tests
      const dot = formatAsDot(graph);
      expect(dot).toContain("digraph CustomEngine {");
      expect(dot).toContain('"CustomEngine" -> "BaseEngine"');
      expect(dot).toContain('label="extends"');

      const pyStub = formatAsPyStub(graph);
      expect(pyStub).toContain("class CustomEngine(BaseEngine, IRunner):");
      expect(pyStub).toContain("workerHelper: WorkerHelper");

      const nxScript = formatAsNetworkX(graph);
      expect(nxScript).toContain('G.add_node("CustomEngine"');
      expect(nxScript).toContain('G.add_edge("CustomEngine", "BaseEngine", rel="extends"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("nativeCodeGraph executes via tool interface and optionally writes to file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "codegraph-tool-"));
    try {
      const code = `
        export class Alpha { run() {} }
        export class Beta extends Alpha { }
      `;
      writeFileSync(join(tempDir, "sample.ts"), code, "utf8");

      const outFile = join(tempDir, "architecture.dot");
      const res = await nativeCodeGraph(
        {
          target: "Beta",
          candidate_files: [join(tempDir, "sample.ts")],
          output_file: outFile,
        },
        undefined,
        tempDir,
        Date.now()
      );

      expect(res.ok).toBe(true);
      expect(res.stdout).toContain("[Graph saved to");
      expect(res.stdout).toContain('"Beta" -> "Alpha"');

      // Verify explicit disk write
      const savedContent = await Bun.file(outFile).text();
      expect(savedContent).toContain('"Beta" -> "Alpha"');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("nativeCodeGraph returns error for empty target", async () => {
    const res = await nativeCodeGraph({}, undefined, process.cwd(), Date.now());
    expect(res.ok).toBe(false);
    expect(res.stderr).toContain("target parameter is required");
  });

  test("module_dependency mode supports upstream, downstream, and both directions", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mod-dep-test-"));
    try {
      // Setup chain: controller -> service -> core
      const coreCode = `export const VERSION = "1.0";`;
      const serviceCode = `import { VERSION } from "./core.js"; export function run() { return VERSION; }`;
      const controllerCode = `import { run } from "./service.js"; export function handle() { return run(); }`;

      const corePath = join(tempDir, "core.ts");
      const servicePath = join(tempDir, "service.ts");
      const controllerPath = join(tempDir, "controller.ts");

      writeFileSync(corePath, coreCode, "utf8");
      writeFileSync(servicePath, serviceCode, "utf8");
      writeFileSync(controllerPath, controllerCode, "utf8");

      const policy = normalizeSaVmPolicy(undefined, tempDir);
      const candidateFiles = [corePath, servicePath, controllerPath];

      // 1. Upstream: controller -> service -> core (depth: 2)
      const upstreamGraph = await buildScopedCodeGraph(
        {
          target: controllerPath,
          mode: "module_dependency",
          direction: "upstream",
          depth: 2,
          candidate_files: candidateFiles,
        },
        policy,
        tempDir
      );
      expect(upstreamGraph.nodes.length).toBe(3);
      expect(upstreamGraph.edges).toContainEqual({
        source: "controller.ts",
        target: "service.ts",
        kind: "imports",
        label: "imports",
      });
      expect(upstreamGraph.edges).toContainEqual({
        source: "service.ts",
        target: "core.ts",
        kind: "imports",
        label: "imports",
      });

      // 2. Downstream: from core, find service and controller (depth: 2)
      const downstreamGraph = await buildScopedCodeGraph(
        {
          target: corePath,
          mode: "module_dependency",
          direction: "downstream",
          depth: 2,
          candidate_files: candidateFiles,
        },
        policy,
        tempDir
      );
      expect(downstreamGraph.nodes.length).toBe(3);
      expect(downstreamGraph.edges).toContainEqual({
        source: "service.ts",
        target: "core.ts",
        kind: "imports",
        label: "imports",
      });
      expect(downstreamGraph.edges).toContainEqual({
        source: "controller.ts",
        target: "service.ts",
        kind: "imports",
        label: "imports",
      });

      // 3. Both: from service, upstream is core, downstream is controller (depth: 1)
      const bothGraph = await buildScopedCodeGraph(
        {
          target: servicePath,
          mode: "module_dependency",
          direction: "both",
          depth: 1,
          candidate_files: candidateFiles,
        },
        policy,
        tempDir
      );
      expect(bothGraph.nodes.some((n) => n.id === "service.ts")).toBe(true);
      expect(bothGraph.nodes.some((n) => n.id === "core.ts")).toBe(true);
      expect(bothGraph.nodes.some((n) => n.id === "controller.ts")).toBe(true);
      expect(bothGraph.edges).toContainEqual({
        source: "service.ts",
        target: "core.ts",
        kind: "imports",
        label: "imports",
      });
      expect(bothGraph.edges).toContainEqual({
        source: "controller.ts",
        target: "service.ts",
        kind: "imports",
        label: "imports",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("handles circular module imports gracefully without infinite recursion", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "circular-mod-test-"));
    try {
      const codeA = `import { b } from "./modB.js"; export const a = 1;`;
      const codeB = `import { a } from "./modA.js"; export const b = 2;`;

      const pathA = join(tempDir, "modA.ts");
      const pathB = join(tempDir, "modB.ts");

      writeFileSync(pathA, codeA, "utf8");
      writeFileSync(pathB, codeB, "utf8");

      const policy = normalizeSaVmPolicy(undefined, tempDir);
      const graph = await buildScopedCodeGraph(
        {
          target: pathA,
          mode: "module_dependency",
          direction: "both",
          depth: 3,
          candidate_files: [pathA, pathB],
        },
        policy,
        tempDir
      );

      expect(graph.nodes.length).toBe(2);
      expect(graph.edges).toContainEqual({
        source: "modA.ts",
        target: "modB.ts",
        kind: "imports",
        label: "imports",
      });
      expect(graph.edges).toContainEqual({
        source: "modB.ts",
        target: "modA.ts",
        kind: "imports",
        label: "imports",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("call_flow mode extracts method call relationships", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "callflow-test-"));
    try {
      const code = `
        export class Pipeline {
          run() {
            this.validate();
            this.execute();
          }
          validate() {}
          execute() {}
        }
      `;
      const file = join(tempDir, "pipeline.ts");
      writeFileSync(file, code, "utf8");

      const policy = normalizeSaVmPolicy(undefined, tempDir);
      const graph = await buildScopedCodeGraph(
        {
          target: "Pipeline",
          mode: "call_flow",
          candidate_files: [file],
        },
        policy,
        tempDir
      );

      expect(graph.rootId).toBe("Pipeline");
      expect(graph.edges).toContainEqual({
        source: "Pipeline.run",
        target: "validate",
        kind: "calls",
        label: "calls",
      });
      expect(graph.edges).toContainEqual({
        source: "Pipeline.run",
        target: "execute",
        kind: "calls",
        label: "calls",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("call_flow mode extracts standalone function and arrow function call relationships across depths", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "funcflow-test-"));
    try {
      const code = `
        export function processOrder(orderId: string) {
          validateOrder(orderId);
          calculateTotal(orderId);
          saveToDb(orderId);
        }
        function validateOrder(id: string) {
          checkInventory(id);
        }
        const checkInventory = (id: string) => {
          queryStock(id);
        };
        function calculateTotal(id: string) {}
        function saveToDb(id: string) {}
        function queryStock(id: string) {}
      `;
      const file = join(tempDir, "order.ts");
      writeFileSync(file, code, "utf8");

      const policy = normalizeSaVmPolicy(undefined, tempDir);

      // 1. Depth 1: only direct callees
      const graphDepth1 = await buildScopedCodeGraph(
        {
          target: "processOrder",
          mode: "call_flow",
          depth: 1,
          candidate_files: [file],
        },
        policy,
        tempDir
      );

      expect(graphDepth1.rootId).toBe("processOrder");
      expect(graphDepth1.nodes.some((n) => n.id === "processOrder" && n.kind === "function")).toBe(true);
      expect(graphDepth1.edges).toContainEqual({
        source: "processOrder",
        target: "validateOrder",
        kind: "calls",
        label: "calls",
      });
      expect(graphDepth1.edges).toContainEqual({
        source: "processOrder",
        target: "calculateTotal",
        kind: "calls",
        label: "calls",
      });
      expect(graphDepth1.edges).toContainEqual({
        source: "processOrder",
        target: "saveToDb",
        kind: "calls",
        label: "calls",
      });
      // Depth 1 should NOT contain checkInventory
      expect(graphDepth1.edges.some((e) => e.target === "checkInventory")).toBe(false);

      // Verify DOT output renders style="dotted" and compact target group
      const dot1 = formatAsDot(graphDepth1);
      expect(dot1).toContain('style="dotted"');
      expect(dot1).toContain('"processOrder" -> {');
      expect(dot1).toContain('"validateOrder"');

      // 2. Depth 3: deep call flow down to arrow function and sub-calls
      const graphDepth3 = await buildScopedCodeGraph(
        {
          target: "processOrder",
          mode: "call_flow",
          depth: 3,
          candidate_files: [file],
        },
        policy,
        tempDir
      );

      expect(graphDepth3.edges).toContainEqual({
        source: "validateOrder",
        target: "checkInventory",
        kind: "calls",
        label: "calls",
      });
      expect(graphDepth3.edges).toContainEqual({
        source: "checkInventory",
        target: "queryStock",
        kind: "calls",
        label: "calls",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("module_deps mode alias behaves identically to module_dependency", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mod-alias-test-"));
    try {
      const codeA = `import { b } from "./b.js"; export const a = 1;`;
      const codeB = `export const b = 2;`;
      const pathA = join(tempDir, "a.ts");
      const pathB = join(tempDir, "b.ts");
      writeFileSync(pathA, codeA, "utf8");
      writeFileSync(pathB, codeB, "utf8");

      const policy = normalizeSaVmPolicy(undefined, tempDir);
      const graph = await buildScopedCodeGraph(
        {
          target: pathA,
          mode: "module_deps",
          candidate_files: [pathA, pathB],
        },
        policy,
        tempDir
      );

      expect(graph.nodes.some((n) => n.id === "a.ts")).toBe(true);
      expect(graph.nodes.some((n) => n.id === "b.ts")).toBe(true);
      expect(graph.edges).toContainEqual({
        source: "a.ts",
        target: "b.ts",
        kind: "imports",
        label: "imports",
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("performance benchmark: 50 iterations JIT query SLA verification", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "benchmark-test-"));
    try {
      // Realistic multi-file structure
      writeFileSync(
        join(tempDir, "base.ts"),
        `export interface IEntity { id: string; }
         export class BaseEntity implements IEntity { id: string = ""; }`,
        "utf8"
      );
      writeFileSync(
        join(tempDir, "user.ts"),
        `import { BaseEntity } from "./base.js";
         export class Profile { bio: string = ""; }
         export class User extends BaseEntity {
           private profile: Profile;
           login() {}
         }`,
        "utf8"
      );

      const policy = normalizeSaVmPolicy(undefined, tempDir);
      const candidates = [join(tempDir, "base.ts"), join(tempDir, "user.ts")];

      // 10 warm-up runs
      for (let i = 0; i < 10; i++) {
        await buildScopedCodeGraph(
          { target: "User", mode: "symbol_hierarchy", depth: 2, candidate_files: candidates },
          policy,
          tempDir
        );
      }

      // 50 measured runs
      const iterations = 50;
      const latencies: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        const graph = await buildScopedCodeGraph(
          { target: "User", mode: "symbol_hierarchy", depth: 2, candidate_files: candidates },
          policy,
          tempDir
        );
        const elapsed = performance.now() - t0;
        latencies.push(elapsed);
        expect(graph.nodes.length).toBeGreaterThanOrEqual(3);
      }

      latencies.sort((a, b) => a - b);
      const min = latencies[0]!;
      const max = latencies[latencies.length - 1]!;
      const avg = latencies.reduce((sum, v) => sum + v, 0) / latencies.length;
      const median = latencies[Math.floor(latencies.length / 2)]!;
      const p95 = latencies[Math.floor(latencies.length * 0.95)]!;

      console.log(
        `\n[Benchmark Results (50 iters)] min: ${min.toFixed(2)}ms, median: ${median.toFixed(2)}ms, avg: ${avg.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms, max: ${max.toFixed(2)}ms`
      );

      // Performance assertion thresholds with headroom for parallel full-suite runs
      expect(avg).toBeLessThan(50); // Average under 50ms
      expect(p95).toBeLessThan(120); // P95 under 120ms under heavy test concurrency
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
