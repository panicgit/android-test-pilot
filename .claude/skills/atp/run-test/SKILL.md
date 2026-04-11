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

For each test step in the scenario file:

### Tier 1: Text-based (try first)
1. Use `atp_logcat_start` to begin logcat streaming (tags: ATP_SCREEN, ATP_RENDER, ATP_API).
2. Perform the action described in the step (launch app, tap, type, etc.).
3. Use `atp_dumpsys` to check current Activity and Window.
4. Use `atp_logcat_read` to check for expected log patterns.
5. If expected logcat patterns match → step PASSED.
6. If no ATP logs found → fall through to Tier 2.

### Tier 2: uiautomator (when Tier 1 can't determine)
1. Use `mobile_list_elements_on_screen` to dump the UI hierarchy.
2. Search for elements by `resource-id` (resolution-independent).
3. If tap is needed, calculate center coordinates from element bounds.
4. Use `mobile_click_on_screen_at_coordinates` to tap.
5. If element found and action succeeded → step PASSED.
6. If element not found → fall through to Tier 3.

### Tier 3: Screenshot (last resort)
1. Use `mobile_take_screenshot` to capture the screen.
2. Analyze the screenshot visually for verification.
3. Check for unexpected popups, image rendering issues.
4. Report PASS or FAIL based on visual analysis.

## Logcat Session Lifecycle

```
Test start → atp_logcat_start
  Step 1 → action → atp_logcat_read (since: 0)
  Step 2 → action → atp_logcat_read (since: lastLine)
  Step N → action → atp_logcat_read (since: lastLine)
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
