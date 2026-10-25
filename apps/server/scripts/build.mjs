import { readFile, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = dirname(dirname(serverRoot));
const outDir = join(serverRoot, "dist");
const outfile = join(outDir, "index.js");
const packageJson = JSON.parse(await readFile(join(serverRoot, "package.json"), "utf8"));
// cxu release version, baked into the bundle for /api/version (top-bar badge).
let cxuVersion = "dev";
try {
  const cxuPackageJson = JSON.parse(await readFile(join(repositoryRoot, "packages", "cxu", "package.json"), "utf8"));
  if (typeof cxuPackageJson.version === "string" && cxuPackageJson.version) cxuVersion = cxuPackageJson.version;
} catch {
  // Keep "dev" when the cxu package manifest is unavailable.
}
const nativeExternal = ["@napi-rs/keyring", "better-sqlite3", "fetch-impersonate", "node-pty"];
for (const dependency of nativeExternal) {
  if (!packageJson.dependencies?.[dependency]) {
    throw new Error(`Missing expected native or dynamic server dependency: ${dependency}`);
  }
}

await rm(outDir, { recursive: true, force: true });
const result = await build({
  entryPoints: [join(serverRoot, "src", "index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: `import { createRequire as __createRequire } from 'node:module';
import { fileURLToPath as __fileURLToPath } from 'node:url';
import { dirname as __dirnameFunction } from 'node:path';
const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirnameFunction(__filename);`,
  },
  minifyIdentifiers: true,
  minifySyntax: true,
  minifyWhitespace: true,
  treeShaking: true,
  sourcemap: false,
  legalComments: "none",
  define: { CXU_VERSION: JSON.stringify(cxuVersion) },
  external: nativeExternal,
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
console.log(`Minified server bundle wrote ${formatBytes(bytes)} to ${relative(repositoryRoot, outfile)}`);

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}
