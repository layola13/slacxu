import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runSaVmTool } from "../../apps/server/src/saVmTool.ts";

function createTestDir(): string {
  const dir = join(tmpdir(), `sa-vm-tail-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("read_file_tail reads the last N lines of a file with line numbers", async () => {
  const dir = createTestDir();
  try {
    const file = join(dir, "app.log");
    const totalLines = 200;
    const content = Array.from({ length: totalLines }, (_, i) => `[${i + 1}] Log entry number ${i + 1}`).join("\n");
    writeFileSync(file, content, "utf8");

    const result = await runSaVmTool({
      action: "read_file_tail",
      path: file,
      lines: 20,
      cwd: dir
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("Mode: Tail reading");
    expect(result.stdout).toContain("Log entry number 200");
    expect(result.stdout).toContain("Log entry number 181");
    expect(result.stdout).not.toContain("Log entry number 180\n");
    // Verify line numbers are present
    expect(result.stdout).toContain("200: [200] Log entry number 200");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read_file with tail=true routes to tail reading", async () => {
  const dir = createTestDir();
  try {
    const file = join(dir, "server.log");
    const content = Array.from({ length: 100 }, (_, i) => `Event line ${i + 1}`).join("\n");
    writeFileSync(file, content, "utf8");

    const result = await runSaVmTool({
      action: "read_file",
      path: file,
      tail: true,
      lines: 10,
      cwd: dir
    } as any);

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("Mode: Tail reading");
    expect(result.stdout).toContain("Event line 100");
    expect(result.stdout).toContain("Event line 91");
    expect(result.stdout).not.toContain("Event line 90\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("read_file_tail handles empty and binary files safely", async () => {
  const dir = createTestDir();
  try {
    const emptyFile = join(dir, "empty.log");
    writeFileSync(emptyFile, "");

    const emptyResult = await runSaVmTool({
      action: "read_file_tail",
      path: emptyFile,
      cwd: dir
    });
    expect(emptyResult.ok).toBe(true);
    expect(emptyResult.stdout).toContain("is empty (0 bytes)");

    const binFile = join(dir, "sample.bin");
    const binBuf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0x05]);
    writeFileSync(binFile, binBuf);

    const binResult = await runSaVmTool({
      action: "read_file_tail",
      path: binFile,
      cwd: dir
    });
    expect(binResult.ok).toBe(true);
    expect(binResult.stdout).toContain("Binary file detected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grep_search_async supports batch queries array for parallel multi-keyword search", async () => {
  const dir = createTestDir();
  try {
    const fileA = join(dir, "serviceA.ts");
    const fileB = join(dir, "serviceB.ts");

    writeFileSync(fileA, `
export function handleAuth() {
  console.log("authenticating");
}
export function handlePayment() {
  console.log("charging card");
}
`, "utf8");

    writeFileSync(fileB, `
export function handleNotification() {
  console.log("send email");
}
export function processOrder() {
  console.log("ordering");
}
`, "utf8");

    // Single query test
    const singleResult = await runSaVmTool({
      action: "grep_search_async",
      dir,
      query: "handleAuth",
      cwd: dir
    });
    expect(singleResult.ok).toBe(true);
    const singleMatches = JSON.parse(singleResult.stdout);
    expect(singleMatches.length).toBe(1);
    expect(singleMatches[0].file).toContain("serviceA.ts");

    // Batch queries test
    const batchResult = await runSaVmTool({
      action: "grep_search_async",
      dir,
      queries: ["handlePayment", "processOrder"],
      cwd: dir
    } as any);

    expect(batchResult.ok).toBe(true);
    const batchMatches = JSON.parse(batchResult.stdout);
    expect(batchMatches.length).toBe(2);

    const matchedQueries = batchMatches.map((m: any) => m.matchedQuery);
    expect(matchedQueries).toContain("handlePayment");
    expect(matchedQueries).toContain("processOrder");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
