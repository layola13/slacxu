import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = resolve(webRoot, "dist");
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";

if (!existsSync(join(distRoot, "index.html"))) {
  console.error("Missing web dist. Run bun run build first.");
  process.exit(1);
}

Bun.serve({
  hostname: host,
  port,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }
    return serveDist(request, url);
  }
});

console.info(`Codex React UI preview listening at http://${host}:${port}`);

function serveDist(request: Request, url: URL): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Not found", { status: 404 });
  }

  const path = decodeURIComponent(url.pathname);
  const candidate = resolve(distRoot, `.${path === "/" ? "/index.html" : path}`);
  const isInsideDist = candidate === distRoot || candidate.startsWith(`${distRoot}${sep}`);
  if (isInsideDist && existsSync(candidate) && statSync(candidate).isFile()) {
    return new Response(request.method === "HEAD" ? null : Bun.file(candidate));
  }

  return new Response(request.method === "HEAD" ? null : Bun.file(join(distRoot, "index.html")));
}
