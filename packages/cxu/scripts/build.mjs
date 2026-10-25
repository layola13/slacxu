import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(here);
const repoRoot = dirname(dirname(pkgRoot));
const outDir = join(pkgRoot, "dist");
const require = createRequire(import.meta.url);

const useBun = await hasBun();
execSync("node scripts/vendor-sa-vm.mjs", { cwd: pkgRoot, stdio: "inherit" });
execSync("tsc -p tsconfig.json", { cwd: pkgRoot, stdio: "inherit" });
await cp(join(repoRoot, "LICENSE"), join(pkgRoot, "LICENSE"), { force: true });
await mkdir(outDir, { recursive: true });

if (useBun) {
  console.log("vm-tools: bundling with bun build");
  execSync("bun build src/index.ts --outdir dist --target node --format esm --minify --external web-tree-sitter --external tree-sitter-wasms", { cwd: pkgRoot, stdio: "inherit" });
  execSync("bun build src/cli.ts --outdir dist --target node --format esm --minify --external web-tree-sitter --external tree-sitter-wasms", { cwd: pkgRoot, stdio: "inherit" });
  execSync("bun build src/postinstall.ts --outdir dist --target node --format esm --minify --external web-tree-sitter --external tree-sitter-wasms", { cwd: pkgRoot, stdio: "inherit" });
} else {
  console.log("vm-tools: bun not found, falling back to esbuild");
  const { build } = await import("esbuild");
  await build({
    entryPoints: [join(pkgRoot, "src", "index.ts")],
    outfile: join(outDir, "index.js"),
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    treeShaking: true,
    external: ["web-tree-sitter", "tree-sitter-wasms"],
  });
  await build({
    entryPoints: [join(pkgRoot, "src", "cli.ts")],
    outfile: join(outDir, "cli.js"),
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    treeShaking: true,
    external: ["web-tree-sitter", "tree-sitter-wasms"],
  });
  await build({
    entryPoints: [join(pkgRoot, "src", "postinstall.ts")],
    outfile: join(outDir, "postinstall.js"),
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    minify: true,
    sourcemap: false,
    legalComments: "none",
    treeShaking: true,
    external: ["web-tree-sitter", "tree-sitter-wasms"],
  });
}

await mkdir(join(pkgRoot, "wasm"), { recursive: true });
await rm(join(pkgRoot, "wasm"), { recursive: true, force: true });
await mkdir(join(pkgRoot, "wasm"), { recursive: true });
try {
  const wasmPkg = require.resolve("web-tree-sitter/tree-sitter.wasm", { paths: [repoRoot, pkgRoot] });
  await cp(wasmPkg, join(pkgRoot, "wasm", "tree-sitter.wasm"));
  console.log("vm-tools: staged tree-sitter.wasm");
} catch (err) {
  console.warn(`vm-tools: tree-sitter.wasm not staged (${err?.message ?? err})`);
}
try {
  const langPkgDir = dirname(require.resolve("tree-sitter-wasms/package.json", { paths: [repoRoot, pkgRoot] }));
  const langOut = join(langPkgDir, "out");
  const keep = [
    "tree-sitter-typescript.wasm",
    "tree-sitter-tsx.wasm",
    "tree-sitter-javascript.wasm",
    "tree-sitter-python.wasm",
    "tree-sitter-rust.wasm",
    "tree-sitter-go.wasm",
    "tree-sitter-zig.wasm",
    "tree-sitter-json.wasm",
    "tree-sitter-toml.wasm",
    "tree-sitter-yaml.wasm",
    "tree-sitter-bash.wasm",
  ];
  await mkdir(join(pkgRoot, "wasm", "languages"), { recursive: true });
  for (const file of keep) {
    try {
      await cp(join(langOut, file), join(pkgRoot, "wasm", "languages", file));
    } catch {
      console.warn(`vm-tools: language wasm missing: ${file}`);
    }
  }
  console.log(`vm-tools: staged ${keep.length} language wasms (c/cpp/java/c_sharp fall back to regex outline)`);
} catch (err) {
  console.warn(`vm-tools: language wasms not staged (${err?.message ?? err})`);
}

// Stage clean web-dist (without .br / .gz duplicates) into main package
const webSource = join(repoRoot, "apps", "web", "dist");
const webTarget = join(pkgRoot, "web-dist");
await rm(webTarget, { recursive: true, force: true });
await mkdir(webTarget, { recursive: true });
function copyWebClean(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) copyWebClean(s, d);
    else if (entry.isFile() && !entry.name.endsWith(".br") && !entry.name.endsWith(".gz")) {
      cpSync(s, d);
    }
  }
}
copyWebClean(webSource, webTarget);
console.log("vm-tools: staged clean web-dist into cxu main package");

const serverBundleSource = join(repoRoot, "apps", "server", "dist", "index.js");
const serverBundleTarget = join(pkgRoot, "server-bundle", "index.js");
if (!existsSync(serverBundleSource)) {
  throw new Error(`Server bundle missing: ${serverBundleSource} (run the root build first)`);
}
await mkdir(join(pkgRoot, "server-bundle"), { recursive: true });
await cp(serverBundleSource, serverBundleTarget);
await writeFile(join(pkgRoot, "server-bundle", "package.json"), JSON.stringify({ type: "module" }, null, 2), "utf8");
console.log("vm-tools: staged server bundle into cxu main package");
// Linux/macOS: ship the sa-vm MCP stdio bridge next to the server bundle so the
// standalone binary (bun --compile, no repo checkout on user machines) has a
// copy source. Windows desktop keeps using desktop-resources/sa-vm; untouched.
const saVmMcpSource = join(repoRoot, "scripts", "sa-vm-mcp.mjs");
if (existsSync(saVmMcpSource)) {
  await cp(saVmMcpSource, join(pkgRoot, "server-bundle", "sa-vm-mcp.mjs"));
  console.log("vm-tools: staged sa-vm-mcp.mjs into server-bundle (linux/macos standalone)");
} else {
  console.warn("vm-tools: sa-vm-mcp.mjs not found, skipping standalone MCP staging");
}

const piRelaySource = join(repoRoot, "extensions", "pi-relay");
if (existsSync(piRelaySource)) {
  const piRelayTargetBundle = join(pkgRoot, "server-bundle", "extensions", "pi-relay");
  const piRelayTargetPkg = join(pkgRoot, "extensions", "pi-relay");
  await mkdir(piRelayTargetBundle, { recursive: true });
  await cp(piRelaySource, piRelayTargetBundle, { recursive: true });
  await mkdir(piRelayTargetPkg, { recursive: true });
  await cp(piRelaySource, piRelayTargetPkg, { recursive: true });
  console.log("vm-tools: staged pi-relay extension into cxu package and server-bundle");
} else {
  console.warn("vm-tools: extensions/pi-relay not found, skipping staging");
}

// Legal policies: copy markdown documents into cxu package
const legalFiles = [
  "PRIVACY.md",
  "PRIVACY_EN.md",
  "TERMS.md",
  "TERMS_EN.md",
  "LICENSE",
  "THIRD_PARTY_LICENSES.md",
  "THIRD_PARTY_LICENSES_EN.md",
  "LEGAL.md",
  "LEGAL_EN.md",
];
const legalTargetDir = join(pkgRoot, "legal");
await mkdir(legalTargetDir, { recursive: true });
for (const file of legalFiles) {
  const src = join(repoRoot, file);
  if (existsSync(src)) {
    await cp(src, join(legalTargetDir, file));
    await cp(src, join(pkgRoot, file));
  }
}
console.log("vm-tools: staged legal documents into cxu package");

// Standalone runtime seed: the Bun-compiled server marks node-pty external,
// so user machines without a repo checkout need a copy source beside the
// bundle. Staged pruned (package.json + lib/ + prebuilds for win32-x64 and
// the build host) to keep the npm payload small; the Windows conpty.node/
// pty.node prebuild is mandatory for terminal/create on win32.
try {
  const nodePtySource = dirname(require.resolve("node-pty/package.json", { paths: [repoRoot, pkgRoot] }));
  const nodePtyTarget = join(pkgRoot, "server-bundle", "node-pty");
  await rm(nodePtyTarget, { recursive: true, force: true });
  await mkdir(nodePtyTarget, { recursive: true });
  await cp(join(nodePtySource, "package.json"), join(nodePtyTarget, "package.json"));
  await cp(join(nodePtySource, "lib"), join(nodePtyTarget, "lib"), { recursive: true });
  const prebuildsSource = join(nodePtySource, "prebuilds");
  const keepPrebuilds = new Set(["win32-x64", `${process.platform}-${process.arch}`]);
  if (existsSync(prebuildsSource)) {
    await mkdir(join(nodePtyTarget, "prebuilds"), { recursive: true });
    for (const entry of readdirSync(prebuildsSource, { withFileTypes: true })) {
      if (!entry.isDirectory() || !keepPrebuilds.has(entry.name)) continue;
      await cp(join(prebuildsSource, entry.name), join(nodePtyTarget, "prebuilds", entry.name), { recursive: true });
    }
  }
  const releaseSource = join(nodePtySource, "build", "Release");
  if (existsSync(join(releaseSource, "pty.node")) || existsSync(join(releaseSource, "conpty.node"))) {
    await mkdir(join(nodePtyTarget, "build", "Release"), { recursive: true });
    for (const file of ["pty.node", "conpty.node", "conpty_console_list.node"]) {
      if (existsSync(join(releaseSource, file))) await cp(join(releaseSource, file), join(nodePtyTarget, "build", "Release", file));
    }
    if (existsSync(join(releaseSource, "conpty"))) {
      await cp(join(releaseSource, "conpty"), join(nodePtyTarget, "build", "Release", "conpty"), { recursive: true });
    }
  }
  console.log("vm-tools: staged pruned node-pty into server-bundle (standalone seed)");
} catch (err) {
  console.warn(`vm-tools: node-pty not staged (${err?.message ?? err})`);
}

for (const f of ["index.js", "cli.js", "postinstall.js"]) {
  const s = await stat(join(outDir, f));
  console.log(`vm-tools: ${relative(repoRoot, join(outDir, f))} ${formatBytes(s.size)}`);
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function stripSourceMappingUrlMarkers(rootDir) {
  const stack = [rootDir];
  let changedFiles = 0;
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".map")) {
        try {
          rmSync(full, { force: true });
          changedFiles += 1;
        } catch {
        }
        continue;
      }
      if (!/\.(?:css|html|js|mjs|cjs)$/i.test(entry.name)) continue;
      let source;
      try {
        source = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const cleaned = source
        .replace(/\/\*[#@]\s*sourceMappingURL=[\s\S]*?\*\//gi, "")
        .replace(/\/\/[#@]\s*sourceMappingURL=[^\r\n]*/gi, "");
      if (cleaned !== source) {
        try {
          writeFileSync(full, cleaned);
          changedFiles += 1;
        } catch {
        }
      }
    }
  }
  return changedFiles;
}

async function hasBun() {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore", timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
