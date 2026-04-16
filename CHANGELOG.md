# Changelog

All notable changes are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — Sprint 1 (improvement/sprint-0-1)

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
