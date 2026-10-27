# FIX_SERVER_STORES — apps/server stores family full body retranslation

Batch: Agent AC, worktree `bulk-store-local`, base `f95c84b` (bulk-convert).
Venue: local VM (JEV server-rest venue ruling p=0.74; stores family
selection p=0.88). Canonical check env: worktree-root cwd,
`SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1`, `.sla-cache` cleared before
every verification, each check `timeout`-wrapped, strictly serial.

Scope: the six A-class skeleton files named by FIX_SERVER_ASYNC —
`providerStore.sla`, `authStore.sla`, `imageProtocols.sla`,
`saVmAccountabilityLedger.sla` (AB's "ledger"), `providerModels.sla`,
`auditLogStore.sla` — retranslated function-body by function-body from
the sibling TS sources, plus one justified out-of-scope fix
(`runtime/password.sla`, see §5).

## 1. Per-file results

| file | BLOCKED before → after | lines before → after | disposition |
|---|---|---|---|
| providerStore.sla | 23 → 0 | 925 → 6390 | full retranslation: sqlite persistence (schema/migrations/groups/catalog tables), keyring + persisted + env secret channels, profile/relay bundle import/export, catalog preview/import wiring |
| authStore.sla | 12 → 0 | 660 → 3284 | full retranslation: sqlite users/sessions/ledger, hand-rolled JWT HS256 (base64url + sa_hmac_sha256_hex), bcrypt via password.sla |
| imageProtocols.sla | 9 → 0 | 67 → 1867 | full retranslation: 4 protocol flows (OpenAI images/edits, Gemini chat/generateContent, DeepKey async video + poll) |
| saVmAccountabilityLedger.sla | 8 → 0 | 63 → 1923 | full retranslation: JSONL store, penalty/reputation engine, Jev write gate + supervisory audit via nativeJevRedteam |
| providerModels.sla | 7 → 0 | 109 → 2455 | full retranslation: v2 HTTP client fetch, per-protocol endpoint builders, test-flow, capability parsing |
| auditLogStore.sla | 5 → 0 | 84 → 673 | full retranslation: sqlite facade, legacy JSONL migration, record/list with TS filter semantics |

Total BLOCKED markers: **64 → 0**. Remaining DEFECT lines: 1 — the
ledger's pre-existing generic/union type-representation note (landed
type note, not an unimplemented body; present in the skeleton at the
same content).

Landed-name audit (per file, skeleton vs final): struct and function
names preserved verbatim, with only the registered exceptions in §4
(six ps_ renames in providerStore, additive takeLastError accessors).

## 2. Census (a / b / c)

- **(a) Faithfully retranslated bodies: all six files, every function.**
  Persistence is real: sqlite via the `plugin_sqlite.sa` facade
  (one-macro-per-helper-fn discipline), fs via sa_std fs surface,
  HTTP via the stateful v2 client, secrets via sa_keyring_*,
  hashing via sa_bcrypt_*/sa_hmac_sha256_hex.
- **(b) Explicitly registered landings/seams: 20 items** — §4. Each is
  a signature- or surface-forced landing with the TS behaviour either
  preserved observably or the divergence stated; none is a silent
  stub.
- **(c) Verbatim TS residue in bodies: 0.** Skeleton comment-bodies
  were replaced wholesale; no preset returns remain.

## 3. Async adjudication (per ASYNC_MODEL / FIX_SERVER_ASYNC)

Async marks in this family: 64 BLOCKED (incl. async-touched sites)
→ 0. No future-typed surface was needed: every awaited callee in
these files is a synchronous sa_std facade — the plugin_sqlite facade
is synchronous by construction, `sa_bcrypt_*`/`sa_hmac_sha256_hex`
are blocking externs, the v2 HTTP client's `req_send_v2` blocks
(status 3 = timeout), and `sa_time_sleep_ms` is a real sleep. This is
the ASYNC_MODEL blocking-contract 1:1 landing, noted per site:

- auditLogStore/authStore/providerStore: all `await db.*` sites land
  on the synchronous sqlite facade, same call order and error
  swallowing as TS.
- imageProtocols poll loop: deadline 300 000 ms with 2 000 ms
  `sleep_ms` slices (a real sleep, not a spin); abort observability
  is registered in §4.7.
- providerModels fetch/test flows: blocking v2 send with the TS
  timeout values (12 s fetch; per-protocol test-flow timeouts).

## 4. Remaining registrations (root cause + source)

1. **relayCatalog stubs (blocker moved out of this batch).**
   `backends/relay-config/src/relay/relayCatalog.sla`'s five exports
   (parseRelayCapabilityCatalog, deriveCatalogGroups,
   buildCatalogImportPreview, mergeCatalogGroups,
   reconcileRequiredImageCatalogGroups) are registered stubs in
   their own unit (backends domain, FIX_BACKENDS). providerStore
   wires every call faithfully (stringify → call → parse); until
   relayCatalog is implemented, capabilityCatalogValue yields
   undefined for every input and catalog preview/import produce
   empty results. Root cause: sibling unit not yet retranslated —
   not an sa_std gap.
2. **LocalDatabase handle seam (auditLogStore, authStore,
   providerStore).** The stores receive a plugin_sqlite connection
   handle (`db: u64`) from the wiring layer; `db == 0` fails closed.
   The SDK's `runtimeDatabase.sla` is itself an unwired driver-tag
   skeleton, so no landed constructor exists to build on.
3. **Ledger gate signature seam.** The landed
   `checkAccountabilityWriteGate` signature carries no config/custom
   policy inputs, so the TS branch that always fires is (b)
   (allowed / GREEN / 100). The full decision tree is implemented in
   `lg_gate_full` and becomes reachable when the wiring widens the
   signature.
4. **Throw channel (authStore, providerStore).** TS exceptions land
   as i32 status (0 ok, 1 thrown / error-specific) with the message
   preserved in a per-file last-error doc cell; additive
   `AuthStore_takeLastError` / `ProviderStore_takeLastError`
   accessors expose it. Error texts are byte-identical to TS
   (verified per throw site against source).
5. **Text caps.** providerStore StoreShape payload text 1 MiB;
   PsText scratch 64 KiB per field; ledger entry/score arrays cap
   128 for scoring while count fields count all entries;
   providerModels model list cap 128; imageProtocols extraction
   recursion depth cap 32. Root cause: fixed-buffer landed shapes.
6. **authStore time semantics.** getUsageSummary day boundaries are
   UTC midnights; TS uses local-time `setHours` (deployment TZ is
   UTC in practice; divergence registered, not hidden). JWT `exp`
   truncates fractional tokenExpireHours products to i64.
7. **imageProtocols poll landings.** Abort is observed via the
   landed snapshot flag at sleep-slice boundaries (later aborts are
   unobservable through the landed signature); a poll failure lands
   as flow status 0 + `{error}` body where TS throws, and a missing
   baseUrl lands as length 0 / error body — both forced by the
   landed i32/text signatures.
8. **Keyring collection asymmetry.** `sa_keyring_get` has no
   collection parameter while set/remove take one (crypto.sai);
   entries are addressed by the `provider:<id>` key alone.
9. **codexUiDataDir env seam.** The SDK fn reads the real process
   env (`CODEX_UI_DATA_DIR`); an env document held by the wiring
   layer cannot override the data dir for the stores.
10. **initialize identity subtlety (providerStore).** TS mutates
    the read() provider object for apiKeyStorage in place; the
    landing mutates the working copy that write() then persists —
    observable outcome identical, object identity not modelled.
11. **Byte vs UTF-16 lengths.** previewSecret, providerModels'
    extractErrorMessage slice(240), and the ledger's Jev context
    slice(1500) operate on UTF-8 bytes; TS slices UTF-16 code
    units. Identical for ASCII; may differ at multibyte boundaries.
12. **providerModels fetch error text.** The undici message
    "fetch failed" cannot be reproduced from the v2 client; the
    timeout text ("Timed out fetching models from …") and the
    HTTP-error body slice (200) are reproduced exactly.
13. **firstProviderModel length convention.** The landed i32
    return carries the written byte length (0 = no model).
14. **booleanToSql sentinel.** Absent boolean → −1 → SQL NULL;
    sqlBooleanValue recognises only 0/1 (matches the row mirror).
15. **Six ps_ renames (providerStore).** asRecord, stringValue,
    booleanValue, stringArray, uniqueStrings, stringRecord collide
    with relayCatalog.sla's unprefixed helpers in the same @import
    closure; landed as ps_asRecord etc. All other module fns keep
    landed names.
16. **Ledger global-cell registries.** String lifetimes for
    entry/path/scratch/gate/Jev docs are held in sa_global cells,
    reset at every public API entry (loop-carried doc rebinding is
    rejected by the checker); evaluateRedemptionWithJev,
    runJevSupervisoryAudit and formatAntibodyNotice are reshaped
    around the landed signatures with reasons noted inline.
    deletePenalty/clearLedger keep the landed −1 return.
17. **auditLogStore ctor dir.** A custom LocalDatabase directory is
    inexpressible in the landed signature; the file path is
    recomputed from codexUiDataDir like the default TS path.
18. **verifyPasswordByEmail (authStore)** is a landed-name
    deformation (no such method exists in authStore.ts); it is
    implemented as normalizeEmail → row lookup → active check →
    bcrypt verify, the only behaviour the name admits.
19. **Stale header claims corrected in-family** (AB class-E audit):
    providerStore's "@napi-rs/keyring has no counterpart" claim is
    false (crypto.sai: sa_keyring_* — wired); the ledger header's
    "no direct sa_std equivalents" for randomUUID/fs is false
    (sa_deno_random_uuid, fs.sai — wired).
20. **imageProtocols stringValue** is the file's own variant
    (typeof string, no trim) and its asRecord does not exclude
    arrays — both verified against the TS source, differing from
    sibling files on purpose.

## 5. Out-of-scope change (justification)

`apps/server/src/runtime/password.sla` (commit `d42f26e`): AB's
class-E named blocker for authStore — the skeleton header asserted
bcrypt had no sa_std counterpart. It does (crypto.sai:
`sa_bcrypt_hash`/`sa_bcrypt_verify`). password.sla now wires
`hashPassword` (out = JSON doc handle `{"hash": …}`, cost 10) and
`verifyPassword`; authStore consumes both. Without this fix the
authStore bodies could not be landed truthfully.

## 6. Compiler-behaviour findings (hit and worked around in-batch)

- An `if/else` whose branch tail is a bare non-void call fails with
  "if expression branch type mismatch" — bind call results to a
  `let` in both branches (3 sites fixed).
- Free-then-reassign of a JSON doc handle inside a branch trips
  UseAfterMove — route through a helper fn that returns the final
  handle (ps_derive_catalog_groups, ps_text_or_empty_array).
- Multi-line boolean expressions whose continuation lines start
  with `&&`/`||` fail parsing; `1e308`-style literals are not
  lexed (pow10 loop instead); `sa_json_stringify` is the two-arg
  status+out-handle form; `sa_json_array_get`, not `_at`.

## 7. Regression gates (final state)

Canonical env, `.sla-cache` cleared, serial, timeout-wrapped:

- apps/server whole set: **97/97 PASS, failure name set ∅**
  (includes all six retranslated files, saVmTool.sla, index.sla).
- miniBridge (backends/mini/src/runtime/miniBridge.sla): PASS.
- mini server (backends/mini/src/server.sla): PASS.

## 8. Local commits (not pushed, no branches created)

- `d42f26e` fix(server): password bcrypt wiring via sa_bcrypt (AB class E handle convention)
- `efe5859` fix(server): auditLogStore full body retranslation (sqlite facade + legacy jsonl migration)
- `7053041` fix(server): saVmAccountabilityLedger full body retranslation (jsonl store, reputation, Jev gate)
- `085b8b4` fix(server): providerModels full body retranslation (v2 http client, endpoint builders, capability parsing)
- `7952506` fix(server): imageProtocols full body retranslation (4 protocol flows, extraction, async video poll)
- `09c0f8d` fix(server): authStore full body retranslation (sqlite/JWT/bcrypt wired)
- `8fa64b8` fix(server): providerStore full body retranslation (sqlite persistence/catalog/keyring)
