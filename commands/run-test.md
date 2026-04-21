---
description: "Step 2 — Run device test from a scenario file using 3-tier strategy (snapshot → text → uiautomator → screenshot)."
allowed-tools: ["Read", "Grep", "Glob", "Bash"]
argument-hint: "<scenario-file-path> — .json preferred, .md with YAML front-matter accepted"
---

# Step 2: Device Test Execution

Read a scenario file and execute tests on a real device using the 3-tier strategy.

## ⛔ HARD RULES — READ BEFORE ANY TOOL CALL

These rules are **non-negotiable**. Violating any of them is a test execution failure.

1. **ALWAYS use `atp_run_step` for every scenario step.** Never call `mobile_take_screenshot`, `mobile_list_elements_on_screen`, or individual tier tools as the primary verification path. `atp_run_step` enforces the tier fallback internally.

2. **Screenshots are FORBIDDEN as the first action.** A screenshot is only legitimate when:
   - `atp_run_step` has already returned a result AND its `tier` field is `"screenshot"`, OR
   - The user *explicitly* asks for a screenshot (e.g., "take a screenshot", "show me the screen"), OR
   - Tier 1 (text) and Tier 2 (uiautomator) have both returned `FALLBACK` in the same step — and even then, `atp_run_step` handles it for you. Do not call the screenshot tool yourself.

3. **Every step MUST pass `expectedLogcat` when logs exist.** Without `expectedLogcat`, Tier 1 has nothing to verify and will pass prematurely on dumpsys alone. Read `.claude/app-map/view_state_map.json` to find the `ATP_SCREEN` / `ATP_RENDER` / `ATP_API` tags for the target screen and include them.

4. **Call `atp_logcat_start` BEFORE the first `atp_run_step`.** Without a live session, Tier 1 falls back to Tier 2/3 even when logs would have matched — this is exactly what causes "screenshots on step 1".

5. **If a step returns `tier: "screenshot"`, STOP and report it.** Screenshot-tier results mean Tier 1 and Tier 2 both gave up. Do not silently accept the pass/fail — surface it as: `⚠️ Step N fell through to screenshot tier. Possible causes: (a) missing ATP_* logcat instrumentation, (b) logcat session not started, (c) UI hierarchy empty. Investigate before continuing.`

6. **Do NOT add a screenshot call "just to be safe" or "for the report".** The tier result already contains the evidence. Extra screenshots defeat the cost model of the tier system.

### Self-check before every tool call

Ask yourself: *"Am I about to call `mobile_take_screenshot` or another mobile_* tool directly?"* If yes, stop — use `atp_run_step` instead, unless rule 2's exception applies.

## Scenario File

$ARGUMENTS

If no scenario file path is provided, stop with:
> No scenario file specified. Usage: `/atp:run-test scenarios/login.md`

Scenario format reference: [`templates/scenario.md`](https://github.com/panicgit/android-test-pilot/blob/main/templates/scenario.md) (also located at `templates/scenario.md` inside the plugin directory).
Before running, call `atp_validate_scenario(path: "<path>")` to catch
typos (ATP_VIEW vs ATP_RENDER) and malformed regex patterns up front.
If the validator returns `ok: false`, stop and surface the errors —
do not attempt to run the scenario.

Read the scenario file and parse each test step.

## Prerequisites

Verify these files exist:
- `.claude/app-map/navigation_map.mermaid`
- `.claude/app-map/api_scenarios.json`
- `.claude/app-map/view_state_map.json`

If any are missing, stop with:
> Step 0/1 artifacts not found. Run `/atp:analyze-app` then `/atp:check-logs` first.

## Device Setup

1. Use MCP tool `mobile_list_available_devices` to find connected Android devices.
2. If no device found, stop with an error.
3. If multiple devices, use the first one (or ask the user to specify).

## Test Execution Strategy

Before starting, use `atp_logcat_start` to begin logcat streaming for the device.

For each test step in the scenario file, use the `atp_run_step` MCP tool:

```
atp_run_step({
  device: "<device-id>",
  action: "<action from scenario step>",
  verification: "<verification from scenario step>",
  expectedLogcat: [
    { tag: "ATP_SCREEN", pattern: "enter: LoginActivity" }
  ],
  tapTarget: { resourceId: "btn_login" }
})
```

`atp_run_step` automatically handles the 3-tier fallback. **You MUST NOT replicate this logic manually by calling individual tier tools.**

1. **Tier 1 (text)** — default. `dumpsys` + `logcat` pattern matching. Fast, cheap, no image tokens. Handles ~80% of steps when `expectedLogcat` is provided.
2. **Tier 2 (uiautomator)** — only if Tier 1 returns `FALLBACK`. UI hierarchy search + resource-id tap.
3. **Tier 3 (screenshot)** — **LAST RESORT ONLY.** Runs only if both Tier 1 and Tier 2 return `FALLBACK`. Reserved for visual-only verification (image rendering, unexpected popups, layout). Expensive in tokens — each hit is a cost regression.

The tool returns a `TierResult` with: tier used, status (SUCCESS/FAIL/FALLBACK/ERROR), observation, and verification details. **Check the `tier` field on every result** — if it reads `"screenshot"` for a step that should have been text-verifiable, that is a bug in either the scenario's `expectedLogcat` or the app's `ATP_*` logcat instrumentation.

### Manual Tier Tools — DEBUGGING ONLY

These exist for interactive debugging, **not for scenario execution**. Do not use them inside a `/atp:run-test` flow:
- `atp_dumpsys` — query current Activity or Window
- `atp_logcat_start/read/stop` — manage logcat sessions (only `start`/`stop` are called in scenarios; `read` is for debug)
- `mobile_list_elements_on_screen` — dump UI hierarchy
- `mobile_take_screenshot` — capture screenshot (**never during a scenario step**)

## Logcat Session Lifecycle

```
Test start → atp_logcat_start
  Step 1 → atp_run_step (auto tier fallback)
  Step 2 → atp_run_step (auto tier fallback)
  Step N → atp_run_step (auto tier fallback)
Test end → atp_logcat_stop
```

## Result Output

Print results as a table:

| Step | Expected | Actual | Tier Used | Result |
|------|----------|--------|-----------|--------|
| 1    | ...      | ...    | text      | PASS   |
| 2    | ...      | ...    | uiautomator | PASS |
| 3    | ...      | ...    | screenshot | FAIL  |

At the end, print a summary: total steps, passed, failed.
