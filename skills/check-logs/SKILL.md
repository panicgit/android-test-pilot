---
name: check-logs
description: "Check and augment logcat log coverage based on Step 0 analysis results"
disable-model-invocation: true
user-invocable: true
allowed-tools: ["Read", "Grep", "Glob", "Bash", "Write", "Edit"]
argument-hint: "(no arguments; requires /atp:analyze-app artifacts)"
---

# Step 1: Log Coverage Check & Augmentation

Check if the source code has sufficient logcat logs for device testing (Step 2),
and offer to add missing logs.

## Prerequisites

Verify these files exist:
- `.claude/app-map/navigation_map.mermaid`
- `.claude/app-map/api_scenarios.json`
- `.claude/app-map/view_state_map.json`

If any are missing, stop with:
> Step 0 artifacts not found. Run `/atp:analyze-app` first.

## 1-A. Screen Entry/Transition Logs

Check:
- Whether a BaseActivity/BaseFragment exists
- Whether each Activity/Fragment has a screen entry log in `onCreate()` or `onResume()`

Expected log format:
```kotlin
Log.d("ATP_SCREEN", "enter: ${this::class.simpleName}")
```

Report any screens missing this log.

## 1-B. View State (renderState) Logs

Using `.claude/app-map/view_state_map.json`, check each screen:
- Whether visibility condition changes are logged

Expected log format:
```kotlin
Log.d("ATP_RENDER", "renderState: screen=${screenName}, ${key}=${value}, ...")
```

Report any View state changes missing this log.

## 1-C. API Response Logs

Using `.claude/app-map/api_scenarios.json`, check each API call site:
- Whether API responses are logged at the response handler

Expected log format:
```kotlin
Log.d("ATP_API", "apiResponse: endpoint=${endpoint}, status=${status}, bodyLength=${responseBody.length}")
```

**Security note**: Avoid logging full response bodies (`body=${responseBody}`) as they may contain PII, authentication tokens, or other sensitive data. Log `bodyLength` instead, or redact sensitive fields before logging.

Report any API call sites missing this log.

## Workflow

1. Run 1-A, 1-B, 1-C analysis and report all gaps.
2. For each gap, ask the developer: "Add this log? (Y/N)"
3. Y → Insert the log directly into the source code.
4. N → Skip that item.
5. No automatic PR creation (developer's decision).

## Log Tag Convention

| Tag | Purpose | Format |
|-----|---------|--------|
| `ATP_SCREEN` | Screen entry/transition | `enter: {ClassName}` |
| `ATP_RENDER` | View state change | `renderState: screen={name}, {key}={value}, ...` |
| `ATP_API` | API response | `apiResponse: endpoint={endpoint}, status={status}, bodyLength={bodyLength}` |
