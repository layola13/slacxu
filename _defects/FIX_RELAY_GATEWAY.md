# FIX: relayProtocolGateway full retranslation (Agent P)

Target: `backends/relay-config/src/relay/relayProtocolGateway.sla`
TS source: `relayProtocolGateway.ts` (5,277 lines, same directory)
Worktree: `/content/bulk-relay` at base `a32e810` (bulk-convert). Local commit only, no push.

## Baseline / final state (name-set discipline)

| | baseline (skeleton) | final |
|---|---|---|
| `sa check` | RC=1, first error `332:1 error.ExpectedDeclaration` (top-level `let`) | **RC=0** |
| lines | 7,110 | 13,450 |
| DEFECT entries | 1,976 lines (K census ~1,916 entries) | 0 pending-zone stubs; 41 in-code seam/registered-deviation comment sites, all itemized below |
| async markers | 84 | 84 dispositioned (table below) |
| top-level mutable `let` | 25 | 0 (cell rebind table below) |
| functions | 177 skeleton shells (`return 0;` ×566) | 434 defined (incl. ported helpers), 0 stubbed |

Check environment: worktree root, `SA_PLUGIN_DEV=1 SLA_NO_FRESHNESS_CACHE=1 SA_SLA_FIXTURE_DIR=<sla>/tests/import_fixtures/ SA_STD_DIR=<sci>/sa_std`, every invocation `timeout 120`, serial.

Import graph (verified before signature repair): nothing `@import`s this file —
`server.sla`, `apps/server/src/{pluginHostServices,auggieRedirector,providerModels,index}.sla`
mention it in comments only. Siblings relayCatalog / omniRouteFree / freebuffSession /
freeOllama all pass check independently.

## Representation model (per FIX_SAVMTOOL)

- Canonical types (CanonicalRequest/Result/Message/Tool/ToolCall/ContentPart,
  RelayToolIdentity/Compatibility, PreparedResponsesRequest, ResponsesStreamWriter,
  CanonicalStreamEvent) are single-`rpg_JsonBuf` carriers, not per-field structs.
- Request JSON = `{url, method, headers:{lower-name:value}, bodyText, signalAborted}`;
  Response JSON = `{status, headers:{lower-name:value}, bodyText}`; streaming
  responses materialize the full SSE text in `bodyText`.
- Signatures repaired per FIX_SAVMTOOL §7: string results via `(out_ptr, out_len)` or
  `&RpgStr`/`&rpg_JsonBuf` outs; Response-returning fns gain an out response param;
  JsonValue transforms take node `u64` → `&u64` new doc + bool has-value.
- Regex: POSIX-ERE per `sa_std/text/regex.sai` header limits (glibc ERE: `\d` is a
  literal 'd' → `[0-9]`/`[[:digit:]]`; `.` matches `\n`; no lookahead/named
  groups/non-greedy/`\p{}`; replacement callbacks inexpressible; `$<name>` literal).

## Zone disposition (TS ranges)

| zone | TS | content | disposition |
|---|---|---|---|
| Z0 | 59–173 | types/consts/globals | head: carriers + ~90 helpers + cell accessors |
| Z1 | 175–311 | fetch timeout + runRelayProtocolRequest | done (driver-loop timeout, see async B) |
| Z2 | 312–453 | predicates, free-channel, diagnostics helpers | done |
| Z3 | 454–777 | embedded opencode | done; execution = host seam, fail-closed (blocker F3) |
| Z4 | 778–834 | duck2api | done; app creation/dispatch = host seam (blocker F4) |
| Z5 | 835–1130 | retry/sleep/failover runners | done; execute callback → kind-tag dispatch (F6) |
| Z6 | 1131–1412 | Jev + Anthropic runners | done |
| Z7 | 1413–1716, 4869–5015 | keys/headers/kernel/endpoints/opencode shaping | done; omni state structs fresh-zero (F2) |
| Z8 | 1717–2138 | responses proxy + diagnostics + stream normalize | done |
| Z9 | 2139–3032 | canonical upstream sync + stream | done |
| Z10 | 3033–3237 | chunk → canonical translators | done; consumeSse/dispatchSseFrame → frame-extraction form |
| Z11 | 3238–3425 | responses prep + tool compatibility | done |
| Z12 | 3426–3703 | request → canonical | done |
| Z13 | 3704–4393 | canonical → protocol emitters | done (gemini safety throw carried as rc=2 + err text) |
| Z14 | 4394–4726 | ResponsesStreamWriter + responsesEventStream | done; writer state = JSON in the `{state}` carrier |
| Z15 | 4727–4868 | prompt cache | done (djb2 hash: byte-wise, ASCII-exact vs UTF-16) |
| Z16 | 4869–5277 | tail helpers | done |

## Cell rebind table — the 25 top-level lets (skeleton line → disposition)

| # | skeleton name (line) | disposition |
|---|---|---|
| 1 | relayToolDiagnostics (332) | bytes cell `rpg.diag` (JSON array text, cap 256) |
| 2 | relayKeyCursors (340) | bytes cell `rpg.keyCursors` (JSON object text) |
| 3 | timeoutMs (378) | mis-scattered local → local of fetchUpstreamWithHeadersTimeout |
| 4 | timer (382) | mis-scattered local → deleted; driver-loop locals |
| 5 | pending (386) | mis-scattered local → stream materialization locals |
| 6 | DEFAULT_ENDPOINTS (407) | const data → `rpg_default_endpoint` accessor |
| 7 | FREE_CHANNEL_RETRY_DELAYS_MS (556) | const `[2000,5000,10000]` inline in resolveFreeRetryDelayMs (+ cap 10000) |
| 8 | IGNORED_PROXY_POOL_ENV_KEYS (594) | const list inline in ignoredProxyPoolEnvKeys |
| 9 | notedIgnoredProxyPoolEnv (618) | u64 cell `rpg.notedProxyPool` (set_once; TS boolean once-flag) |
| 10 | embeddedOpencodeRunner (815) | bytes cell `rpg.opencodeRunner` (descriptor JSON; unset = not configured) |
| 11 | EMBEDDED_OPENCODE_SSE_HEADERS (944) | const header set built inline at stream responses |
| 12 | duck2apiApp (1172) | bytes cell `rpg.duck2apiApp` (descriptor; creation via host seam, failures not cached — TS parity) |
| 13 | RESPONSES_EFFORT_LEVELS (4942) | const level set inline in sanitizeResponsesEffort |
| 14–25 | instructions, messages, systemContent, safeContent, entry, firstMsg, firstBlock, body, chatEffort, seenChat, uniqueChat, choice (5164–5302) | mis-scattered locals from converter bodies → locals of the owning fns (canonicalToChat / canonicalToAnthropic / canonicalToGemini / canonicalToResponsesRequest) |

Companion state (TS module state not emitted as skeleton lets):
`relayToolDiagnosticId` → u64 cell `rpg.diagId` (locked add);
omni kernel identity state → cells `rpg.kernelTs` / `rpg.kernelCtr` / `rpg.kernelMemo`
(KernelIdState + KernelIdentityMemo from omniRouteFree, whose typed structs have no
producer — see F2). Initial-state semantics checked per cell: unset cell
(`NOT_FOUND=3`) ≡ TS initial value (empty array/object, 0, null, false) in every case.

No WeakMap sites exist in the gateway itself (the domain's WeakMap sites are all in
omniRouteFree, already rebound to `sa_idmap_*` by Agent K — not touched).

`fs_exists`: 0 call sites in this file (no direct fs existence checks; the freebuff
credentials path is passed through to freebuffSession). Polarity rule therefore has
no site to audit here.

## Async table — all 84 markers, by site class

| class | count | sites | ruling |
|---|---|---|---|
| A. Blocking-contract runners | 54 | runRelayProtocolRequest(2), …WithKeyFailover(3), runRelayChatRequest(3), …WithKeyFailover(3), runRelayJevRequest(3), …WithKeyFailover(3), runNativeAnthropicRequest(3), runRelayAnthropicRequest(3), …WithKeyFailover(2), runCanonicalUpstream(2), runCanonicalUpstreamStream(3), runCanonicalUpstreamChatStream(2), runAnthropicCanonicalStream(2), proxyResponsesRequest(2), proxyResponsesCompactRequest(2), executeWithFreeChannelRetry(3), bufferRelayRequestForRetry(2), rebuildRelayRequest(1), fetchEmbeddedD2ApiCompletions(2), requestEmbeddedD2ApiCompletions(3), runEmbeddedOpencodeLocalResult(3), runEmbeddedOpencodeLocalLive(2) | Per ASYNC_MODEL: TS async here is I/O sequencing; the SLA host drives the gateway synchronously, so each fn is a blocking contract (materialized response in out jb + i32). No flattening: every await maps to a blocking std call, retry/failover loops preserved 1:1, try/catch carried by status codes. |
| B. Timeout race | 3 | fetchUpstreamWithHeadersTimeout | Driver-loop poll over `sa_http_client_async_poll_v2` in 10 ms slices against an `rpg_now_ms` deadline. NOT select2, per the brief's ruling (select2 right-branch compiler defect at brief time). Note: the four-defect compiler fix landed mid-run (sa_plugin_sla `969d8535`, incl. Loop continuation plan + select2 both-branch wins verified by the parent); the port keeps the driver loop, which remains the canonical form for externally-polled ops. |
| C. Stream callbacks | 10 | consumeSse(3), translateNativeEventStream(2), translateCanonicalEventsToChat(1), translateCanonicalEventsToAnthropic(1), normalizeResponsesProxyStream(1), streamEmbeddedOpencodeChatTurn(1), streamEmbeddedOpencodeResponsesTurn(1) | Callback seam repaired to materialized frame iteration (`rpg_sse_next`) + writer/body accumulation. The embedded runner's live-delta callback is inexpressible (fn-ptr); a configured runner's deltas would materialize before framing (moot while F3 stands). |
| D. Retry decision callbacks | 6 | tryOpencodeObservedRetry(3), tryOpencodeShapeRetry(3) | `fetchPayload` callback inexpressible → decision half here (retry body or none), the caller performs the fetch + outcome note. Same repair as Z5's kind-tag dispatch. |
| E. Abortable sleep | 3 | sleepWithSignal | AbortSignal snapshot at entry; mid-wait flip has no SLA counterpart (registered in code). |
| F. Sync fns with marker noise | 8 | (top)(1), embeddedOpencodeErrorStatus, duck2apiCompletionsPath, isRetryableFreeStatus, shouldFailOverRelayKey, noteOpencodeUpstreamOutcome, unwrapCustomToolInput, hasUnsupportedOllamaThinking | TS sources are synchronous; markers were bulk-conversion noise. Ported as plain sync fns. |

No silent flattening anywhere: every class above is either a 1:1 blocking
equivalent or an explicitly registered seam (C/D/E).

## Remaining blockers by family (all host-wiring stage; the file itself is check-green)

- **F1. Sibling stub surfaces (sibling domains, not this file).**
  relayCatalog.sla `resolveModelProtocol` always yields `"openai-response"` and
  `modelSupportsProtocol` always returns true (K-registered stubs in that file);
  the gateway consumes them as-is. freebuffSession.sla
  `getOrEnsureFreebuffSession` always returns 3 (K-registered stub) and
  `FreebuffState` has no SLA producer — the gateway passes a fresh zero state per
  call, so freebuff-group canonical requests end at the TS catch branch (400 with
  the code-3 text shape; inner text approximated as "session admission failed").
  First error if exercised: `Failed to admit Freebuff session for <model>: …`.
  Sources: sibling files in this worktree; CAPABILITY_MAP.md; FIX_BACKENDS.md §3/§7.
- **F2. omniRouteFree typed state structs have no producer** (`ChannelGroupConfig`
  is never constructed in omniRouteFree.sla; same for OpencodeShapeState /
  OpencodeObservedStore / OpencodeCliVersionCache producers). Ruling applied
  per site: fresh zero-constructed state per call + in-code registration —
  cross-request opencode shape/observed learning and CLI-version caching do not
  persist across requests until the host wires real state. Kernel identity state
  is the exception: it persists via the `rpg.kernel*` cells (Z7a).
- **F3. Embedded opencode runner (host seam, FIX_BACKENDS §4).** The runner is a
  host-injected function; SLA has no fn-ptr surface for it in this import graph.
  Unconfigured → TS-exact fail-closed 502 text. Configured descriptor present →
  explicit seam error text (classified 502 by embeddedOpencodeErrorStatus).
  `rotateOpenCodeSession` (sdk-backend) likewise has no SLA surface here; the
  local observable effect is advancing the `rpg.kernelCtr` cell (Z5, registered).
- **F4. duck2api app (host seam, FIX_BACKENDS §4).** Creation
  (`pluginHostServices().relay.createDuck2ApiApp()`) and in-process dispatch
  (`app.request`) are host-side. Port: cell-cached descriptor check +
  TS-wrapped error text (`Embedded duck2api request failed: … (host seam)`),
  failures not cached (TS parity).
- **F5. HTTP surface limits of sa_std.** Response headers cannot be enumerated —
  only read by name: the fetch path copies a 14-name known set
  (`rpg_resp_copy_known_headers`). `sa_http_fetch_bytes`/v2 client does not
  expose status text; fetch failures surface as the port's error strings where
  TS interpolates `errorMessage(error)` (AbortError "Upstream timeout (30s)"
  is indistinguishable at this surface — registered at the Jev + fetch sites).
- **F6. Callback-typed parameters (FIX_BACKENDS §4 family).**
  `executeWithFreeChannelRetry`'s `execute` callback → kind-tag dispatch
  (0 protocol / 1 chat / 2 anthropic) into the three runners; Z10/Z14 callback
  forms repaired as in async classes C/D.
- **F7. Platform/text approximations (registered in code).** `process.platform`
  → `"linux"` (cline X-PLATFORM); `Date.parse` → IMF-fixdate only
  (upstreamRetryAfterSeconds); string lengths are bytes where TS counts UTF-16
  units (diagnostic truncation, incomplete-arguments message, image data-url
  chars); `errorMessage(SyntaxError)` → the literal `"JSON parse error"` at the
  parse-failure envelopes; SSE response header names lowercased by the
  gateway's header store (TS emits capitalized names on two stream paths);
  `runCanonicalUpstreamStream` mirrors a TS quirk faithfully — a successful
  freebuff refresh inside its `!ok` block does not recover the stream.

## Method notes (defects found in my own intermediate chunks, fixed before delivery)

- `resolveProtocolEndpoint` / `resolveProtocolStreamEndpoint` return `void`
  (Z7a), not i32 — 9 binding sites across Z6/Z8/Z9 unbound.
- `jn_kind` / `rpg_now_ms` / `rpg_index_of` return u64/i64/i64 — 10 binding
  sites re-typed.
- `FreebuffSessionInfo` literal requires `has_is_owned` (sibling struct field
  not in the original census).
- One leftover placeholder call (`name_p_unused()`) in Z8 removed.
- While blocks take no trailing `;` — enforced across all chunks (scanner pass).
