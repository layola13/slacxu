// Test-only fetch shim for sa-vm-mcp.mjs, loaded via `node --import`.
// Scripts canned 127.0.0.1 responses by call order so bridge port-selection
// logic is tested without touching real ports:
//   SHIM_RESPONSES="401,200"   -> 1st candidate 401s, 2nd succeeds
//   SHIM_RESPONSES="401"       -> every candidate 401s (queue repeats last)
const plan = (process.env.SHIM_RESPONSES || "401,200").split(",").map((s) => s.trim());
const tried = [];
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("http://127.0.0.1:")) return realFetch(url, init);
  tried.push(u);
  const step = plan[Math.min(tried.length - 1, plan.length - 1)];
  if (step === "401") {
    return new Response(JSON.stringify({ error: "Unauthorized", code: "CUX-AUTH-001" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }
  if (step === "200") {
    return new Response(
      JSON.stringify({ data: { ok: true, stdout: `SHIM-OK tried=${tried.join("|")}`, stderr: "" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
  throw Object.assign(new Error(`connect ECONNREFUSED ${u}`), { code: "ECONNREFUSED" });
};
