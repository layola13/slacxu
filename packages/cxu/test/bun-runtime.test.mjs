import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe("npm package hygiene (zero prebuilt binaries)", () => {
  it("whitelists only runtime assets and legal/package documents", async () => {
    const pkg = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8"));
    assert.deepEqual(pkg.files, [
      "dist", "wasm", "web-dist", "server-bundle", "extensions", "legal",
      "PRIVACY.md", "PRIVACY_EN.md", "TERMS.md", "TERMS_EN.md", "LEGAL.md",
      "LEGAL_EN.md", "THIRD_PARTY_LICENSES.md", "THIRD_PARTY_LICENSES_EN.md",
      "README.md", "LICENSE",
    ]);
  });

  it("declares no binary/native dependencies", async () => {
    const pkg = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
    for (const name of Object.keys(deps)) {
      assert.ok(!/napi|better-sqlite3|keyring|electron/i.test(name), `${name} must not ship in the pure-TS package`);
    }
  });

  it("declares no per-platform server packages (local bun compile instead)", async () => {
    const pkg = JSON.parse(await readFile(join(pkgRoot, "package.json"), "utf8"));
    const optional = Object.keys(pkg.optionalDependencies ?? {});
    assert.deepEqual(optional.filter((name) => name.startsWith("@codex-ultra/cxu-")), []);
  });
});
