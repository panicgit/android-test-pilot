---
name: run-test
description: "Run device test from a scenario file using 3-tier strategy (text → uiautomator → screenshot)"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Glob Bash
argument-hint: <scenario-file-path>
---

# Step 2: Device Test Execution

Read a scenario file and execute tests on a real device using the 3-tier strategy.

## Scenario File

$ARGUMENTS

If no scenario file path is provided, stop with:
> No scenario file specified. Usage: `/atp:run-test scenarios/login.md`

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

`atp_run_step` automatically handles the 3-tier fallback:
1. **Tier 1 (text)**: dumpsys + logcat pattern matching — fast, cheap
2. **Tier 2 (uiautomator)**: UI hierarchy search + resource-id tap — if Tier 1 can't determine
3. **Tier 3 (screenshot)**: visual capture — last resort, only if Tier 1+2 both fail

The tool returns a `TierResult` with: tier used, status (SUCCESS/FAIL/FALLBACK/ERROR), observation, and verification details.

### Manual Tier Tools (optional, for debugging)

Individual tier tools are also available for direct use:
- `atp_dumpsys` — query current Activity or Window
- `atp_logcat_start/read/stop` — manage logcat sessions
- `mobile_list_elements_on_screen` — dump UI hierarchy
- `mobile_take_screenshot` — capture screenshot

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
