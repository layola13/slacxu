/**
 * Dependency-direction conformance (R2): plugin projects must only
 * call the SDK. Any import specifier in a backend project that points
 * at host code (apps/server, apps/web) or escapes into another
 * project through relative paths is a defect — this test is the
 * regression gate for the "plugins only call the SDK" rule.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const repoRoot = join(import.meta.dir, "../..");

function collectSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]!);
}

describe("plugin dependency direction", () => {
  test("backend projects import no host modules", () => {
    const offenders: string[] = [];
    for (const file of collectSources(join(repoRoot, "backends"))) {
      for (const specifier of importSpecifiers(file)) {
        if (
          specifier.includes("apps/server") ||
          specifier.includes("apps/web") ||
          specifier.includes("apps/") ||
          specifier.includes("frontends/")
        ) {
          offenders.push(`${file.replace(repoRoot + "/", "")} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("frontend projects import no host modules", () => {
    const offenders: string[] = [];
    for (const file of collectSources(join(repoRoot, "frontends"))) {
      for (const specifier of importSpecifiers(file)) {
        if (
          specifier.includes("apps/server") ||
          specifier.includes("apps/web") ||
          specifier.includes("apps/") ||
          specifier.includes("backends/")
        ) {
          offenders.push(`${file.replace(repoRoot + "/", "")} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The string checks above cannot see relative specifiers: a specifier
  // like "../../../claude/src/x.js" names no tree literally, yet escapes
  // the importing project. Resolve every relative specifier and require
  // it to stay inside the importing project's own directory — plugins
  // reach shared code through the SDK packages, never through a
  // sibling project.
  test("plugin projects contain no cross-project relative imports", () => {
    const offenders: string[] = [];
    for (const tree of ["backends", "frontends"]) {
      for (const file of collectSources(join(repoRoot, tree))) {
        const rel = file.replace(repoRoot + "/", "");
        const projectRoot = join(repoRoot, tree, rel.split("/")[1]!);
        for (const specifier of importSpecifiers(file)) {
          if (!specifier.startsWith(".")) continue;
          const target = resolve(dirname(file), specifier);
          if (target !== projectRoot && !target.startsWith(projectRoot + sep)) {
            offenders.push(`${rel} -> ${specifier}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
