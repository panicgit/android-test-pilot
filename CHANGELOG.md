# Changelog

All notable changes are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.1] — 2026-04-21

Plugin release-readiness hotfix. `v0.2.0` shipped with manifest schema
drift that would have prevented Claude Code from registering either the
skills or the MCP server on a strict-schema loader; `v0.2.1` corrects the
manifest, fills documentation gaps, and commits compiled output so the
plugin works from a bare git clone.

### Fixed
- Plugin manifest (`.claude-plugin/plugin.json`) switched from
  unsupported `skills` + inline `mcp` fields to the canonical
  `mcpServers: "./.mcp.json"` pointer. Renamed plugin from `atp` to
  `android-test-pilot`. Added author/homepage/repository/license/keywords
  metadata.
- `.mcp.json` now uses `${CLAUDE_PLUGIN_ROOT}/lib/index.js` for portable
  entry resolution.
- `.gitignore` no longer hides `lib/`; the compiled MCP entry now ships
  with the repo so a fresh marketplace install works without a build
  step.
- `skills/run-test/SKILL.md` — `ATP_VIEW` typo corrected to `ATP_RENDER`;
  broken relative link to `templates/scenario.md` replaced with the
  GitHub URL.
- `skills/check-logs/SKILL.md` — `ATP_API` format table aligned with
  the PII-safe `bodyLength=` guidance (previously contradicted its own
  security note).
- `src/server.ts` — removed unused duplicate `isLikelyCatastrophicRegex`.
- `package.json` — `@types/pixelmatch` and `@types/pngjs` moved from
  `optionalDependencies` to `devDependencies`.
- `README.md` — project-structure diagram updated to match the actual
  `skills/` root-level layout.

### Added
- `README.md` "Telemetry" section documenting which events may fire
  (only when a `POSTHOG_API_KEY` is configured — the default
  distribution ships without one), what is and is not transmitted, and
  the `MOBILEMCP_DISABLE_TELEMETRY=1` opt-out.

## [Unreleased]

### Batch 4 — docs + DX (improvement/batch-4-docs-dx)

#### Documentation
- **D1** — README now opens with a 5-minute Quickstart showing the
  five-command happy path from `adb devices` to the first scenario
  result table.
- **D2** — `examples/sample-app-map/` with fully filled Mermaid
  navigation, API scenarios JSON, and view-state map JSON so adopters
  can compare their own `/atp:analyze-app` output against a reference.
  Paired with `examples/scenarios/quickstart-login.json`.

#### Skills / DX
- **DX2** — `allowed-tools` switched to array syntax across all four
  SKILL.md files (previously space-separated strings).
- **DX3** — `argument-hint` added to every skill (previously only on
  run-test).
- **DX8** — `app-map` skill description clarifies it's a **viewer**
  and depends on `/atp:analyze-app` having already run.
- **DX9** — run-test SKILL.md now points at
  `templates/scenario.md` and instructs the model to call
  `atp_validate_scenario` before executing any step, surfacing
  ATP tag typos and bad regexes up front.

### Batch 3 — new features (improvement/batch-3-features)

#### Features
- **A7** — `atp_validate_scenario` MCP tool and `ScenarioSchema` Zod
  definition. Lint scenarios before `atp_run_step` reaches them.
  Supports `.json` and `.md` (YAML front-matter). Pre-parse raw-text
  scan catches the canonical typos (`ATP_VIEW`, `ATP_SCREENS`,
  `ATP_APIS`, etc.) with corrected-tag suggestions. tapTarget refinement
  enforces "resourceId OR both x/y"; regex patterns must compile.
- **C5 / S3-5** — `SnapshotTier` (priority 0) for visual-regression
  verification. Steps declare `expectedSnapshot: { name, threshold?,
  createIfMissing? }`; tier captures a PNG, pixel-diffs against
  `.claude/baselines/{name}.png` via pixelmatch + pngjs, writes a diff
  image alongside on FAIL. Baseline is auto-created on first run by
  default. Pre-empts TextTier so visual regressions can't be hidden
  behind a logcat pass.
- **A10 / S3-4** — structured tracing. `atp_run_step` wraps each
  phase (`act`, `verify`, settle delay) in a `TraceContext` span and
  returns the collected summary as `traceSummary` on every response.
  JSONL emitted to `$ATP_TRACE_FILE` when set — OTel-compatible span
  shape without pulling the OpenTelemetry SDK.

#### Dependencies
- `pixelmatch` and `pngjs` added under `optionalDependencies`. The
  snapshot tier fails gracefully (FALLBACK) if either is missing, so
  installs that skip native binaries still work.

#### Tests (+20)
- `test/scenario.test.ts` (8 cases)
- `test/snapshot-tier.test.ts` (7 cases)
- `test/tracing.test.ts` (5 cases)

### Batch 2 — tier system refactor (improvement/batch-2-refactor)

#### Architecture
- **A3** — `LogcatSessionRegistry` extracted into `src/logcat-registry.ts`.
  Module-level `activeSessions` Map + signal handlers gone. Registry is
  DI-friendly — tests inject fresh instances, multi-server scenarios
  no longer share state.
- **A6 + A8 + A9** — all `atp_*` MCP tool registrations moved out of
  server.ts (1083 → 870 lines) into `src/atp-tools.ts`. server.ts hosts
  only the upstream mobile-mcp surface plus a single
  `registerAtpTools(...)` call. Merge-conflict surface for upstream
  rebases is now the mobile_* block only.
- **UPSTREAM.md** documents fork-specific files, rebase procedure, and
  the marketplace-only distribution policy.

#### Tests (+7)
- `test/logcat-registry.test.ts` — add/get/delete, per-device and
  global cap enforcement, latestForDevice tie-break, two-registry
  isolation, stopAndRemove.

### Batch 1 — security hardening + cleanup (improvement/batch-1-security-cleanup)

#### Security
- **SR-4** — SSE bearer token comparison is now `crypto.timingSafeEqual`,
  closing the first-differing-byte timing channel.
- **SR-5** — `resolveAppMapDir()` realpaths and asserts containment
  inside `ATP_PROJECT_ROOT`; symlinks escaping the project root are
  refused.
- **SR-6** — `MOBILEMCP_ALLOW_INSECURE_LISTEN=1` only permits loopback
  hosts. Routable-interface bind without auth is a fatal refusal.
- **SR-7** — `expectedLogcat.pattern` rejected at the API boundary if
  it matches nested-unbounded-quantifier or unbounded-alternation
  shapes known to cause catastrophic backtracking.
- **SR-2** — card-number redaction Luhn-validates before replacing,
  eliminating false positives on timestamps/trace IDs.

#### Type safety
- **T1** — `tool()` wrapper generic over the Zod schema shape; tool
  callbacks receive `z.infer<ZodObject<S>>` so field-name typos and
  type mismatches fail at compile time. Enforcement surfaced and fixed
  a real issue: `mobile_press_button` schema corrected from
  `z.string()` to `z.enum([...Button])`.
- **T-R2** — `formatAdbError` replaces the unchecked `as` cast with
  an `isChildProcessError` type predicate.
- **T-R4** — `app-map.ts` collapses `existsSync`-then-`readFileSync`
  into a single try/catch (TOCTOU fix).
- **T-R6** — `flattenTierResult` uses explicit per-branch object
  construction; no terminal cast.

#### Performance / architecture
- **A4** — `AbstractTier._robot` cache removed; tiers are stateless.
- **P10** — single `SHARED_TIER_RUNNER` at module scope, reused across
  every `atp_run_step` call.

#### Tests (+17 cases)
- `test/app-map-symlink.test.ts` — SR-5 containment (3 cases).
- `test/flatten-tier-result.test.ts` — T4/T-R6 discriminated-union
  flattening (4 cases).
- `test/uiautomator-tier.test.ts` — A5 phase dispatch, tap-by-
  resourceId, fallback paths (7 cases).
- `test/redaction.test.ts` — Luhn false-positive guard (+1 case).

### Sprint 3 (improvement/sprint-3-final)

#### Correctness
- **A5** — `atp_run_step` now splits action from verification.
  `TierContext.phase` (`"act"` | `"verify"`) gates each tier; UiAutomatorTier
  no longer claims SUCCESS for a step that declared `expectedLogcat`
  without checking logs. Response carries `actResult` + `verifyResult`
  while mirroring the verify result into legacy top-level fields.

#### Performance
- **T5 + P5** — entire ADB surface converted to async. `adb()` and
  `silentAdb()` return `Promise<Buffer>` via `util.promisify(execFile)`.
  All AndroidRobot instance methods await. AndroidDeviceManager
  enumeration becomes Promise-returning. Event loop is no longer
  blocked for up to 30s per tool call.
- **P6** — `TextTier.execute` fires `getDumpsysActivity` and
  `getDumpsysWindow` in `Promise.all`, ~2× wall-clock on the dumpsys step.

#### Documentation
- **C4 + C10 + S3-7** — `docs/instrumentation-guide.md` covers
  BuildConfig gating, Proguard keep rules (Log.println bypass),
  Jetpack Compose `testTagsAsResourceId`, Timber adapter, and the
  recomposition-storm avoidance pattern. Linked from README and
  TROUBLESHOOTING.

### Distribution pivot
**Breaking** — android-test-pilot is no longer published to npm.
Distribution is exclusively via the Claude Code marketplace
(`panicgit/android-test-pilot`). `package.json` `bin`, `main`,
`homepage`, `bugs`, `repository`, `engines.npm`, and `files` fields
removed; `.npmignore` removed; `release.yml` (npm publish workflow)
removed. The `prepare` script still builds `lib/` on `npm install` so
marketplace installs work out-of-the-box.

### Review follow-up (on top of Sprint 2/3)
- Completed T2 and T6 — `mobile_take_screenshot` no longer uses
  `posthog().then()`; remaining `catch (error)` bindings in android.ts
  stripped to bare `catch {}`.
- **SR-1 + SR-3** redaction fixes — Basic auth stripped, JSON-encoded
  values (`"password":"hunter2"`) no longer leak the trailing value
  fragment.
- Bench harness no longer a tautology — adds `tier-2-fallback.json` and
  `tier-3-fallback.json`; realistic baseline is tier1=0.56, tier2=0.22,
  tier3=0.22 (up from a hand-crafted 1.00/0.00/0.00).
- `ScreenshotTier` resize is resilient to empty buffers.
- Fixed dead link in TROUBLESHOOTING.md to the planned instrumentation
  guide; inlined the short Proguard recipe instead.

### Sprint 2/3 (improvement/sprint-2-3)

#### Code quality
- **T2** — all `catch (error: any)` replaced with `catch (error: unknown)`
  and `error instanceof Error` narrowing at ATP-owned sites. Extracts
  `formatAdbError()` helper for execFileSync throws. iOS-side files kept
  untouched to minimize upstream mobile-mcp diff.
- **T6** — `posthog(...).then()` replaced with `void posthog(...)` at 3
  sites; `main().then()` replaced with `.catch(exit(1))` so unhandled
  rejections no longer silently crash.
- **T7** — duplicated `device: z.string().describe(...)` Zod schema
  consolidated into a single `DEVICE_SCHEMA` constant (25 occurrences).
- **T8** — `getAndroidRobotFromDevice(deviceId)` helper replaces the
  `getRobotFromDevice + isAndroidRobot` guard at 5 ATP tool callbacks.
- **T4** — `TierResult` converted to a discriminated union keyed by
  `status`, with `fallbackHint`/`error`/`verification` required on the
  respective variants. Wire format unchanged via `flattenTierResult()`
  helper.

#### Reliability
- **H1** — SIGTERM/SIGINT graceful drain — each logcat child is signalled
  then awaited (2s bound) so the tail of the log buffer is flushed
  before exit.

#### Performance
- **P1** — removed the ADB `echo ping` round-trip from every tier's
  `canHandle()`; saves ~150-900ms per `atp_run_step` call.
- **P7** — memoized `isScalingAvailable()`, `isSipsInstalled()`,
  `isImageMagickInstalled()` probes.
- **P8** — `ScreenshotTier` now downscales to 540px JPEG q75 before
  base64 encoding. ~15-30× vision-token cost reduction on Tier-3
  fallback steps when scaling tools are present.
- **P9** — `TextTier` pre-compiles all `expectedLogcat` regexes once per
  step instead of per log-line scan.

#### Security
- **S8** — `atp_logcat_read` redacts obvious secrets (Bearer tokens,
  `token|password|api_key|auth|session_id|cookie` values, emails, card
  numbers) before returning lines to the MCP client. Opt out with
  `MOBILEMCP_DISABLE_REDACTION=1`.

#### Documentation
- **D3** — `TROUBLESHOOTING.md` — first-run and live-testing failure
  modes with copy-paste fixes, linked from README.
- **D6** — `docs/architecture.md` with Mermaid flowchart of tier
  dispatch, result type contract, and logcat session lifecycle.
- **D8** — `ActionableError` messages for logcat session-not-found now
  include an explicit "Next step:" hint.

#### CI/CD
- **O6** — `.github/workflows/ci.yml` (test matrix Node 18/20/22 ×
  Ubuntu/macOS, bench regression gate) and `release.yml` (tag-push →
  npm publish with provenance).
- Issue templates (bug, feature) and PR template.

### Tests
- 28 tests pass (up from 22). New: `test/redaction.test.ts` (6 cases).

### Sprint 1 (merged to main)

### Fixed (correctness)
- **C2** — `TextTier` no longer returns `SUCCESS` when `expectedLogcat` is
  empty. Falls back to the next tier so the action can be performed and
  verified. Opt back in via `step.skipVerification = true`.
- **C8** — `atp_run_step` now auto-starts an idempotent logcat session when
  `expectedLogcat` is provided, removing the "model forgot
  `atp_logcat_start`" foot-gun that caused all steps to drop to Tier 3.
- **A1** — `AppMap` loader extracted into `src/app-map.ts`. Resolves the
  artifact directory from `ATP_PROJECT_ROOT` (falls back to `process.cwd()`),
  caches reads by mtime, and surfaces missing/invalid artifacts as
  structured warnings on the `atp_run_step` response (`appMapWarnings`).
- **T9** — Step 0 JSON artifacts are now validated against Zod schemas;
  malformed JSON or shape mismatches surface as warnings, not silent empties.

### Security
- **S3** — SSE server (`--listen`) refuses to start without `MOBILEMCP_AUTH`.
  Override only via `MOBILEMCP_ALLOW_INSECURE_LISTEN=1` (with a prominent
  warning) for trusted local development.
- **S2 + H8** — `startLogcat` enforces `MAX_SESSIONS_PER_DEVICE=3` and
  `MAX_GLOBAL_SESSIONS=50` to prevent fd/memory exhaustion via tight loops.
- **S6** — `expectedLogcat[].pattern` validated through Zod (length 1–200,
  must compile as a regex), rejecting catastrophic-backtracking inputs at
  the API boundary.
- **H2** — Logcat buffer additionally capped at `MAX_LOGCAT_BYTES=64MB` so
  one verbose session can no longer OOM the server. Dropped bytes reported
  via `atp_logcat_stop` stats.

### Distribution
- **O1** — `package.json` `files` corrected from `.claude/skills` (empty) to
  `skills` (the real path after the 2f4ed05 plugin flatten). Skills are
  finally included in published tarballs.
- **O4** — `LICENSE` (Apache-2.0) and `NOTICE` files added with
  upstream mobile-mcp attribution.
- **O3** — `.npmignore` added as defense-in-depth alongside `files`
  allowlist.
- **O8** — `package.json` adds `homepage`, `bugs`, `repository`, and
  `engines.npm`.
- **O10** — This `CHANGELOG.md` introduced.

### Tooling
- New `bench/` harness — offline tier-routing benchmark with regression
  thresholds (Tier 1 ratio >5% drop or latency >20% rise fails). Run via
  `npm run bench`.

### Tests
- 22 tests pass. New: `test/text-tier.test.ts` (5 cases),
  `test/app-map.test.ts` (6 cases).

### Deferred (Sprint 2)
- **A5** (action/verification split) — too risky for this sprint, requires
  a `phase` field on `TierContext` and changes tier semantics.
- **A7** (scenario JSON Schema + `atp_validate_scenario`) — design needs
  user review.

## [0.1.0] — 2026-04-11

Initial public release. Forked from mobile-mcp; adds Android-specific
3-tier test strategy, ATP_* logcat instrumentation convention, and four
slash commands (`/atp:analyze-app`, `/atp:check-logs`, `/atp:run-test`,
`/atp:app-map`).
