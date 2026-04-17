# Troubleshooting

Common failure modes hit during first-run setup and live testing. Search this
file before filing an issue — most symptoms are environment gaps, not bugs in
the tool itself.

## Setup

### `adb: command not found` or `ENOENT spawn adb`
**Cause**: `adb` is not on `PATH` and `ANDROID_HOME` is not set.
**Fix**:
```bash
# macOS (Android Studio default location)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

# Linux
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```
Add these lines to `~/.zshrc` / `~/.bashrc` so every shell session has them.

### `mobilecli is not available or not working properly`
**Cause**: The optional `@mobilenext/mobilecli` native binary failed to install
(often on Linux ARM or musl-based distros).
**Fix**: Install the binary manually per
https://github.com/mobile-next/mobile-mcp/wiki, or set
`MOBILEFLEET_ENABLE=0` (default) and use Android-only tools — `atp_*` tools do
not require mobilecli.

## Device connection

### `mobile_list_available_devices` returns empty
**Causes**:
1. No device is plugged in or no emulator is running.
2. USB debugging is not enabled on the device.
3. The computer is not authorized (check the device screen for a prompt).
4. `adb devices` shows the device as `unauthorized` or `offline`.

**Fix**:
```bash
adb devices          # what ADB sees
adb kill-server && adb start-server  # reset the daemon
```
Make sure the device screen shows "Always allow from this computer" checked.

### `Device "emulator-5554" not found`
**Cause**: The emulator stopped or the device ID you're passing is stale.
**Fix**: Re-run `mobile_list_available_devices` to get the current ID.
Android emulator IDs survive restarts but can shift if multiple AVDs run.

## Tier fallback

### Every step falls through to `tier: "screenshot"`
**Symptom**: `atp_run_step` response has `tier: "screenshot"` repeatedly.

**Causes**:
1. The app is missing `ATP_*` log instrumentation (Tier 1 cannot verify).
2. Logcat session was not started. Note: since Sprint 1, `atp_run_step`
   auto-starts a session if `expectedLogcat` is provided — confirm your
   scenario actually passes `expectedLogcat` entries.
3. The target activity uses Jetpack Compose without `Modifier.semantics`
   exposing a resource-id (Tier 2 cannot find the tap target).

**Fix**:
- Run `/atp:check-logs` to audit ATP_* coverage.
- In Compose UIs, add `Modifier.semantics { testTagsAsResourceId = true;
  testTag = "btn_login" }` to elements you want to target.
- For release builds, ensure `ATP_*` tags are not stripped by R8/Proguard.
  See [docs/instrumentation-guide.md](docs/instrumentation-guide.md)
  for the full recipe (BuildConfig gating, Proguard keep rules, Compose
  semantics tags, Timber adapter, recomposition-storm avoidance).

### `Logcat session "XYZ" not found. It may have expired or been stopped`
**Cause**: The session timed out (default 60s, max 300s), or the device
disconnected mid-test.
**Fix**: `atp_logcat_start` with a higher `durationSeconds` (up to 300), or
call it again — atp_run_step auto-starts a fresh session.

### `Device "emulator-5554" already has 3 active logcat sessions`
**Cause**: You hit the per-device concurrent-session cap (S2 defence against
runaway spawning).
**Fix**: Call `atp_logcat_stop` on one of the existing sessions, or wait for
their `durationSeconds` timer to expire.

## Scenario / app-map

### `Step 0/1 artifacts not found. Run /atp:analyze-app then /atp:check-logs first`
**Cause**: `.claude/app-map/*` files don't exist.
**Fix**: Run the two commands in order. If the MCP server runs from a
different working directory than your project root, set
`ATP_PROJECT_ROOT` to point at the project root explicitly.

### `atp_run_step` response contains `appMapWarnings`
**Cause**: One of the three Step 0 artifacts is missing or malformed (JSON
parse error or schema mismatch).
**Fix**: Each warning names the specific file. Re-run `/atp:analyze-app` to
regenerate it. The scenario continues running with degraded context.

### `Invalid regex pattern (max 200 chars; must compile)`
**Cause**: An `expectedLogcat[].pattern` is either >200 chars or contains a
regex syntax error.
**Fix**: Shorten and fix the pattern. Prefer simple substrings (e.g.
`"btnEnabled=true"`) over multi-capture regexes.

## Security / SSE mode

### SSE server refuses to start: "MOBILEMCP_AUTH must be set"
**Cause**: Starting the server with `--listen` without an auth token.
**Fix**:
```bash
export MOBILEMCP_AUTH=$(openssl rand -hex 32)
android-test-pilot --listen 0.0.0.0:3000
```
For trusted local development only, override with
`MOBILEMCP_ALLOW_INSECURE_LISTEN=1` — the server prints a loud warning.

## Reporting a bug

If your issue is not here, open
[a bug report](https://github.com/panicgit/android-test-pilot/issues/new?template=bug.md)
with:
- Node.js version (`node -v`)
- ADB version (`adb --version`)
- Device / emulator and API level
- Minimal reproduction (scenario file + atp_run_step args)
- MCP response JSON (including `appMapWarnings` if present)
