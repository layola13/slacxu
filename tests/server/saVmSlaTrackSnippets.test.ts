import { expect, test } from "bun:test";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { SLA_VERIFIED_RECIPES } from "../../apps/server/src/saVmWorkspaceSkill";

const runtimeRoot = join(import.meta.dir, "../../desktop-resources/sa-vm");
const saExe = join(runtimeRoot, "sa.exe");
const stdDir = join(runtimeRoot, "sa_std");
const hasCompiler = existsSync(saExe) && existsSync(stdDir) && process.env.CODEX_UI_SA_VM_LIVE_TESTS === "1";

test("FR-5: SLA_VERIFIED_RECIPES metadata structure and coverage", () => {
  expect(SLA_VERIFIED_RECIPES.length).toBe(7);

  const ids = new Set<string>();
  for (const recipe of SLA_VERIFIED_RECIPES) {
    expect(recipe.id).toBeTruthy();
    expect(ids.has(recipe.id)).toBe(false);
    ids.add(recipe.id);

    expect(recipe.name).toBeTruthy();
    expect(recipe.sourceOrigin).toBeTruthy();
    expect(recipe.jsConcept).toBeTruthy();
    expect(recipe.slaPattern).toBeTruthy();
    expect(recipe.fullSource).toBeTruthy();

    expect(recipe.fullSource).toContain("fn main() -> i32");

    const validPrefix =
      recipe.sourceOrigin.startsWith("demos/rosetta/") ||
      recipe.sourceOrigin.startsWith("desktop-resources/sa-vm/") ||
      recipe.sourceOrigin.startsWith("tests/test_unit_");
    expect(validPrefix).toBe(true);
  }

  // Covers all 7 required categories from FR-5
  const expectedIds = [
    "println_fmt",
    "while_accumulator",
    "string_ops",
    "fs_read_file",
    "fs_write_file",
    "fs_read_dir",
    "result_propagation"
  ];
  for (const id of expectedIds) {
    expect(ids.has(id)).toBe(true);
  }
});

test.skipIf(!hasCompiler)("Test Plan 2: every SLA recipe passes 'sa sla check' (exit code 0)", () => {
  for (const recipe of SLA_VERIFIED_RECIPES) {
    const tempFile = join(tmpdir(), `sla_test_${recipe.id}_${Date.now()}.sla`);
    try {
      writeFileSync(tempFile, recipe.fullSource, "utf-8");

      const res = spawnSync(saExe, ["sla", "check", tempFile], {
        env: {
          ...process.env,
          SA_PLUGIN_DEV: "1",
          SA_STD_DIR: stdDir
        },
        encoding: "utf-8"
      });

      const stdout = res.stdout || "";
      const stderr = res.stderr || "";
      const combined = `${stdout}\n${stderr}`;

      expect(res.status).toBe(0);
      expect(combined).toContain("Successfully parsed and verified syntax and types");
      expect(combined).not.toContain("Type Check Error");
      expect(combined).not.toContain("Parse Error");
    } finally {
      if (existsSync(tempFile)) {
        try {
          unlinkSync(tempFile);
        } catch {
          // ignore cleanup error
        }
      }
    }
  }
});

test.skipIf(!hasCompiler)("Test Plan 2 (negative assertion): sa sla check fails when given invalid SLA code", () => {
  const tempFile = join(tmpdir(), `sla_test_invalid_${Date.now()}.sla`);
  try {
    const invalidSource = `fn main() -> i32 {
    let x: i32 = "type mismatch";
    return x;
}`;
    writeFileSync(tempFile, invalidSource, "utf-8");

    const res = spawnSync(saExe, ["sla", "check", tempFile], {
      env: {
        ...process.env,
        SA_PLUGIN_DEV: "1",
        SA_STD_DIR: stdDir
      },
      encoding: "utf-8"
    });

    const combined = `${res.stdout || ""}\n${res.stderr || ""}`;
    expect(res.status).not.toBe(0);
    expect(combined).toContain("Type Check Error");
  } finally {
    if (existsSync(tempFile)) {
      try {
        unlinkSync(tempFile);
      } catch {
        // ignore cleanup error
      }
    }
  }
});
