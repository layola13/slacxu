# FIX_INDEX_REGISTRY — BJ line: index.sla F-class (18 async markers) + ServerPluginRegistry wiring

Line BJ (2026-10-28), base = bulk-convert `ecf8635`, worktree
`/content/bulk-server-bj`. Scope: the 18 `// DEFECT: async` markers in
`apps/server/src/index.sla` and their stated prerequisite — the
sdk-backend `ServerPluginRegistry` wiring behind FIX_INDEX **B3**.

## 1. What the 18 markers actually were (scope forensics)

Per FIX_SERVER_ASYNC §F, the 18 markers annotate the untranslated TS
comment regions catalogued by FIX_INDEX (B2–B6 host blockers); the file
was otherwise untouched. They were never 18 independent defects: each
one marks a *region* of index.ts whose body has not been retranslated.
The registry wiring closes the one marker whose blocker was the
registry itself (B3 — which is a `DEFECT(F3-B3)` comment inside
`isCliPluginEnabled`, adjacent to but not one of the 18). The other 18
are adjudicated below, one by one, with the precise remaining blocker
and owner; none of them is closable by registry work alone, and none is
silently dropped — each line now carries a `BJ-ADJ` tag in index.sla
pointing here.

## 2. The registry wiring (deliverable ①)

**The sdk registry body was already real** (`sdk-backend/src/index.sla`
lines 82–197: the fixed-arena `ServerPluginRegistry` + register /
unregister / get / has / ids / list / defaultPlugin). What was missing
was every consumer: nothing registered a single plugin, and
`apps/server/src/pluginHost.sla` — the composition root whose TS fills
the registry — was comment-only stubs behind a commented-out import in
index.sla. BJ wires the chain end to end:

- **`apps/server/src/pluginInstallStore.sla`** — implemented (it is
  pluginHost's persistence dependency): `resolvePluginDataDir`
  (CODEX_UI_DATA_DIR trim-or-home fallback), `pluginInstallStorePath`,
  `loadInstalledPluginIds` (defaults on missing/corrupt/non-array;
  string-filter + dedup), `saveInstalledPluginIds` (mkdir -p + the
  byte-exact `JSON.stringify({installed: [...ids].sort()}, null, 2) +
  "\n"` layout). env travels as a JSON doc handle (0 = process env);
  strings are delivered as (ptr, len) into JSON string-node arenas.
- **`apps/server/src/pluginHost.sla`** — implemented:
  `PluginHostRegistry` embeds the sdk `ServerPluginRegistry` **by
  value** (the bulk-era `registry: u64` placeholder predates the sdk
  unit being importable here; registry handles are the registration
  slots 0..11, exactly the sdk's documented "u64 into the host's
  plugin table" model). `pluginHost_init` parses the 17 plugin.json
  texts (inlined verbatim, mechanically transcribed — the method
  reproduces backends/mini's own inlined manifest byte-for-byte) and
  registers the 12 server plugins in pluginHost.ts order: mini, codex,
  claude, agy, auggie, cline, command-code, grok, pi, opencode,
  opencode-v2, muse; slots 12–16 hold the catalog-only manifests
  (relay-config, jev, vmtool-security, free-mode, enhance). All nine
  declared accessors are real: `cliDiscoveryForKind` (kind tag →
  registry → discovery JSON doc {binaryNames, envBinVars,
  preferredPathPrefKey?}; unknown → status 1, the TS throw),
  `allPluginManifests` (17 docs), `cliSettingsEntries` (11 entries),
  `cliPluginIdForSettingsSlug`, `cliSettingsLinks` (6 records),
  `defaultInstalledPluginIds` ([mini, relay-config, jev,
  vmtool-security, free-mode, enhance]), `pluginCatalog` (17 entries
  with installed/locked), `setPluginInstalled` (0 ok / 1 unknown id /
  2 locked-uninstall, the TS throws as statuses; persists through
  pluginInstallStore and returns the fresh catalog).
- **`apps/server/src/index.sla`** — the pluginHost import is activated;
  `isCliPluginEnabled`'s cache-miss path is the real TS algorithm
  (entries lookup → env var → `cliPluginEnabledByDefault` → **cache
  the computed value**). The `DEFECT(F3-B3)` comment is removed:
  **FIX_INDEX B3 is closed.**

### Why the data is transcribed at the registration point (registered seam of form)

The backend units are **not co-importable** into one compilation unit:
`backends/codex/src/server.sla`, `backends/claude/src/server.sla` and
the backends' `manifest.sla` units each define their own `struct
ServerPlugin` / `struct PluginManifest` and same-named free functions,
so importing two collides. pluginHost.ts has the same shape in TS — it
is the single registration point that reads each plugin's declared
values — so pluginHost.sla transcribes the cliSettings/discovery
tables from `backends/<b>/src/server.ts` (the SLA backend units declare
the same values; where they differ in form — codex/claude record byte
lengths over zero-filled arrays marked "filled by host init" — the
host-side fill is this table). Data and behavior are the TS ground
truth; only the import path is a seam.

### Registered seams inside the wiring

1. **matchesKind / createEngine / findInstallations / skillRoots stay
   PTR_NULL.** The qualifier and engine functions live in the
   non-co-importable backend units; discovery *data* is delivered in
   full, kind-matching and engine creation belong to the backend-host
   glue (BH / host-services scope). Never approximated here.
2. **pluginHostServices import stays commented** in pluginHost.sla:
   its register fn is a stub and wiring it needs the sdk hostServices
   surface plus cliVersions (BI) and codeCliBridge (BH); index.sla
   does not consume it.
3. **Storage form bends around a compiler defect** — see §4.1: the
   cliSettings/discovery values are stored in a flat byte arena with
   (off, len) primitive tables (the sdk registry's own idiom) instead
   of `[CliSettingsDeclaration; 12]` / `[CliDiscoverySpec; 12]`.
4. ASCII-only trim (CODEX_UI_DATA_DIR, env flags) — JS trim also
   covers Unicode whitespace; same registered note as
   `cliPluginEnabledByDefault`. POSIX path joins; win32 separator
   handling is a platform seam per the server family precedent.
5. opencode-v2's `preferredPathPrefKey` is `"cliPreferredOpencodePath"`
   — the same key as opencode's — transcribed verbatim from
   `backends/opencode-v2/src/server.ts` (TS quirk, not introduced here).

## 3. The 18 markers — disposition table

All 18 are disposition **(b) registered seam** (region not yet
retranslated; precise blocker + owner). Census for this line's own
work: the registry chain (§2) is (a) real; (c) verbatim-TS = 0. Line
numbers are the post-BJ index.sla positions.

| # | Line | Region (index.ts) | Disposition |
|---|------|-------------------|-------------|
| 1 | 881 | ensureSaVmGlobalBundleInstalled fire-and-forget — module-body startup sequence (module body) | (b) region untranslated; the callee in saVmBundle.sla is real since AD3 — closes with the index bootstrap region work |
| 2 | 884 | async fetch-Response closure — miniBridge construction region (652–776) | (b) region untranslated; miniBridge.sla itself is real — index region work |
| 3 | 908 | miniBridge_resolveRelayTarget — same region (652–776) | (b) index region work |
| 4 | 959 | resolveRelayProxyConfig — constants/config region (888–1029) | (b) index region work |
| 5 | 1139 | runEmbeddedOpencodeLocalTurn — embedded opencode (1346–1400) | (b) FIX_RELAY_GATEWAY F3 host seam: runner lives in backends/mini, fail-closed — relay/host scope (BH-adjacent) |
| 6 | 1142 | same fn (Promise executor/AbortSignal detail) | (b) same host seam as #5 |
| 7 | 1303 | startup roster refresh (2112–2190) | (b) index bootstrap region work |
| 8 | 1305 | omniroute startup refresh IIFE — relay region (7389–7889) | (b) relay region work |
| 9 | 1457 | pruneOrphanClaudeConfigDirs — Claude config region (12186–12678) | (b) that region's work |
| 10 | 1515 | handleHttpRequest (2243–2482) | (b) Bun server object model vs sa_std http surface — server runtime region work |
| 11 | 1595 | handleApiRequest (2483–6345) | (b) server runtime region work; **its pluginHost prerequisite (settings/capabilities/plugins routes) is closed by §2** |
| 12 | 1824 | startThreadAgentMember — thread roster region (6406–6767) | (b) index region work |
| 13 | 1873 | project discussion engine (6683–7259), poll loop + timers | (b) index region work |
| 14 | 1908 | runGatewayRequestWithLog — relay region (7389–7889) | (b) relay region work |
| 15 | 1938 | resolveAuth — static/auth region (7890–8107) | (b) index region work |
| 16 | 2081 | executeCodexRpc (9224–10240) | (b) index region work |
| 17 | 2145 | handleClientMessage — WS region (10241–10436) | (b) index region work |
| 18 | 2297 | createClaudeBridge — Claude bridge region (12186–12678) | (b) region untranslated; bridge construction is the LazyBridge B2 family (codeCliBridge = BH scope) — main-session coordination |

Plus, outside the 18: **B3 (in `isCliPluginEnabled`) — (a) CLOSED** by
§2, and the other DEFECT(F3-*) tags (B2 ×6, B4, B5 ×3, B6) are not
F-class markers; they are untouched and remain owned by their lines
(B5's auggie/cline/command-code bridge delegates belong to the backends
runtimes; B4's agySettingsGuard snapshot export likewise).

## 4. Compiler defects found (registered for the BG line — not fixed here)

### 4.1 Array-of-composite element addressing collapses in the SAB backend

Indexing an array whose element is a struct or another array collapses
every index to a single element at runtime (writes to slot k land in
the same cell for all k; reads alias identically). `sa check` passes;
the failure is runtime-only. Flat primitive arrays ([u64; N],
[bool; N], [u8; N]) index correctly.
Minimal repros: `_defects/probes/bj_dbg2.sla` (struct array, local +
field forms, constant + variable indices) and
`_defects/probes/bj_dbg3.sla` (nested byte arrays collapse; sibling
primitive arrays in the same struct are correct — pins the defect to
composite element types). This is the family of registered residual
#17 (stack-array literal corruption) but a distinct shape: repeat-fill
literals + indexed field access, not multi-element literal reads.
pluginHost's storage form (§2 seam 3) works around it; the workaround
should be reverted to the sdk structs when the backend is fixed.

### 4.2 `&ptr`-returning externs cannot be passed directly as `ptr` arguments

`sa_env_buffer_data`, `sa_fs_read_buffer_data`, `sa_json_string_ptr`
(and `sa_json_buffer_data`) are declared `-> &ptr` in the .sai files.
Passing their result directly as a `ptr` argument to a user-defined
function fails type check (`checkExpr failed at call ... with N args
(error.TypeMismatch)`); materializing into a typed local first
(`let p: ptr = sa_env_buffer_data(h);`) works, as does assignment
position generally. Bisected with a minimal probe (direct pass fails,
materialized pass passes). Existing tree code (e.g. saVmBundle passing
`sa_json_string_ptr(el)` to `sa_json_array_push_string`) is unaffected
because those callees declare matching parameter types. Registered
for BG/sci triage: either the checker should coerce at argument
position as it does at assignment, or the .sai declarations should be
`-> ptr`.

## 5. Evidence (gates + probes)

Baseline (pristine ecf8635) vs final, canonical env, `.sla-cache`
cleared, failure **name sets**:

- Standing gates: index.sla PASS → PASS; miniBridge.sla PASS → PASS;
  backends/mini server.sla PASS → PASS.
- sdk-backend domain: 26/26 PASS → 26/26 PASS (sdk files untouched).
- apps/server set (97 files): 96 PASS, failures {saVmTool.sla} →
  96 PASS, failures {saVmTool.sla} — identical name set (the StrBuf
  redeclaration is byte-identical to baseline; no new failure names).
- Runtime probes (`_defects/probes/run_bj_probes.sh`): BJ_PROBE_OK —
  registry id order, 17 manifests, 11 settings entries (codex fields
  exact; auggie linkKey absent), slug lookup, 6 links, 6 defaults,
  discovery docs for kinds 0 and 9 + unknown-kind status, catalog
  defaults, install codex + persistence across a fresh host, locked
  (rc 2) and unknown (rc 1) errors, store file byte-exact vs
  JSON.stringify layout. BJ_B3_PROBE_OK in all three env modes
  (unset / =1 / =yes), including cache-wins-over-env after
  setCliPluginEnabled.

## 6. Files changed

- `apps/server/src/pluginHost.sla` — stubs → real wiring (§2).
- `apps/server/src/pluginInstallStore.sla` — stubs → real (§2).
- `apps/server/src/index.sla` — pluginHost import activated;
  `isCliPluginEnabled` miss path wired (B3 closed); 18 markers tagged
  `BJ-ADJ` with dispositions.
- `_defects/probes/bj_probe.sla`, `bj_b3_probe.sla`,
  `run_bj_probes.sh` — runtime evidence.
- `_defects/probes/bj_dbg2.sla`, `bj_dbg3.sla` — defect repros (§4.1).
- `_defects/FIX_INDEX_REGISTRY.md` — this document.

No sdk-backend files were edited (the registry body needed no changes);
no BH/BI files were touched.
