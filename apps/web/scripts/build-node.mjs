import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transform } from "esbuild";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(webRoot, "dist");
const publicDir = join(webRoot, "public");
const entryPoint = join(webRoot, "src/main.tsx");
const templatePath = join(webRoot, "index.html");
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await build({
  entryPoints: [entryPoint],
  outdir: outDir,
  bundle: true,
  splitting: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
  minify: true,
  sourcemap: false,
  legalComments: "none",
  treeShaking: true,
  metafile: true,
  entryNames: "assets/[name]-[hash]",
  chunkNames: "assets/chunk-[hash]",
  assetNames: "assets/[name]-[hash]",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  loader: {
    ".eot": "file",
    ".gif": "file",
    ".jpg": "file",
    ".jpeg": "file",
    ".png": "file",
    ".svg": "file",
    ".ttf": "file",
    ".webp": "file",
    ".woff": "file",
    ".woff2": "file"
  }
});

await cp(publicDir, outDir, { recursive: true, force: true });
await refreshServiceWorkerBuildId(buildId);

const outputEntries = Object.entries(result.metafile.outputs);
const entryOutput = outputEntries.find(([, output]) =>
  output.entryPoint && resolve(output.entryPoint) === resolve(entryPoint)
);
if (!entryOutput || !entryOutput[0].endsWith(".js")) {
  throw new Error("Node web build did not produce a JavaScript entry.");
}

const script = toRootPath(relative(outDir, resolve(entryOutput[0])));
const stylesheet = entryOutput[1].cssBundle
  ? toRootPath(relative(outDir, resolve(entryOutput[1].cssBundle)))
  : null;
const template = await readFile(templatePath, "utf8");
const html = template
  .replace(/\s*<script type="module" src="\/src\/main\.tsx"><\/script>\s*/, `\n    <script type="module" src="${script}"></script>\n`)
  .replace("</head>", `    <meta name="codex-react-ui-build" content="${buildId}" />\n${stylesheet ? `    <link rel="stylesheet" href="${stylesheet}" />\n` : ""}  </head>`);

await writeFile(join(outDir, "index.html"), html);

const totalBytes = outputEntries.reduce((sum, [, output]) => sum + output.bytes, 0);
await assertNoSourceMaps(outDir);
console.log(`Node web build ${buildId} wrote ${outputEntries.length} outputs (${formatBytes(totalBytes)}) to ${relative(process.cwd(), outDir) || basename(outDir)}`);

function toRootPath(path) {
  return `/${path.split(sep).join("/")}`;
}

async function refreshServiceWorkerBuildId(id) {
  const swPath = join(outDir, "sw.js");
  const sw = await readFile(swPath, "utf8");
  const result = await transform(sw.replaceAll("__BUILD_ID__", id), {
    loader: "js",
    target: "es2022",
    minify: true,
    sourcemap: false,
    legalComments: "none"
  });
  await writeFile(swPath, result.code);
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

async function assertNoSourceMaps(directory) {
  const { readdir } = await import("node:fs/promises");
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (path.endsWith(".map")) throw new Error(`Production build emitted a forbidden source map: ${path}`);
      if (!/\.(?:css|html|js|mjs|cjs)$/.test(path)) continue;
      const contents = await readFile(path, "utf8");
      if (/[/][/*][#@]\s*sourceMappingURL\s*=/.test(contents)) {
        throw new Error(`Production build emitted a sourceMappingURL marker: ${path}`);
      }
    }
  }
}
