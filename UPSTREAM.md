# Upstream (mobile-mcp) fork policy

android-test-pilot is a fork of
[mobile-next/mobile-mcp](https://github.com/mobile-next/mobile-mcp) (Apache-2.0).

## What we inherit

- `src/robot.ts` — the cross-platform `Robot` interface.
- `src/ios.ts`, `src/iphone-simulator.ts`, `src/webdriver-agent.ts` — iOS code
  paths, preserved untouched so future rebases stay low-effort.
- `src/mobilecli.ts`, `src/mobile-device.ts` — fleet / simulator helpers.
- `src/image-utils.ts`, `src/png.ts`, `src/utils.ts`, `src/logger.ts` —
  shared utilities.
- All `mobile_*` MCP tool registrations in `src/server.ts`.

## What is fork-specific (android-test-pilot only)

Kept deliberately in separate files so `git merge upstream/main` rarely
conflicts:

| File | Purpose |
|------|---------|
| `src/atp-tools.ts` | All `atp_*` MCP tool registrations |
| `src/logcat-registry.ts` | `LogcatSessionRegistry` — DI-friendly owner of adb-logcat children |
| `src/app-map.ts` | Step 0 artifact loader (navigation / API / view-state) |
| `src/tiers/*.ts` | 3-tier test strategy (TextTier, UiAutomatorTier, ScreenshotTier, TierRunner) |
| `src/android.ts` (Android-side additions) | `startLogcat`/`readLogcat`/`stopLogcat`/`ensureLogcatSession`, `getDumpsysActivity`/`getDumpsysWindow`, `redactLogcatLines` |
| `skills/` | Claude Code slash-command skill definitions (`/atp:*`) |
| `bench/` | Offline tier-routing regression harness |

`src/server.ts` is a thin assembly — it hosts the upstream `mobile_*`
tool registrations and, at the end of `createMcpServer`, calls
`registerAtpTools(...)`. No fork-specific tool logic lives in that file.

## Fork point

Forked from `mobile-next/mobile-mcp` — see the initial commit of the
public repo for the SHA. mobile-mcp upstream has since received MCP SDK
updates; rebases should pull those in without touching atp-specific
files.

## Merging upstream changes

```bash
git remote add upstream https://github.com/mobile-next/mobile-mcp.git
git fetch upstream
git merge upstream/main
```

Expected conflict surface on each rebase:

1. **`src/robot.ts`** — if upstream changes the Robot interface, re-check
   that `AndroidRobot` still implements it. Usually non-conflicting.
2. **`src/server.ts`** — the `mobile_*` tool block is the primary merge
   zone. Our `registerAtpTools(...)` call at the bottom should survive
   upstream changes to the block above it.
3. **`src/android.ts`** — upstream changes Android helpers; we added the
   logcat + dumpsys methods at the end. Merge keeps both.

After merge:

```bash
npm ci && npm run build && npm test && npm run bench
```

If `bench/results/baseline.json` Tier 1 ratio drops more than 5%,
investigate — an upstream refactor may have broken Tier 1 dispatch.

## What we never change

- `src/ios.ts`, `src/iphone-simulator.ts`, `src/webdriver-agent.ts`,
  `src/mobilecli.ts`, `src/mobile-device.ts`.
- Upstream `mobile_*` tool signatures (description, schema names) —
  renaming breaks downstream MCP clients.

## Distribution

android-test-pilot is distributed **only** through the Claude Code
marketplace (`panicgit/android-test-pilot`). There is no npm publish.
See `CHANGELOG.md` for the distribution pivot commit.
