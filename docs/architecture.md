# Architecture

High-level diagram of what happens during a single `atp_run_step` call.

```mermaid
flowchart TD
    A[atp_run_step called] --> B{expectedLogcat provided?}
    B -- yes --> C[ensureLogcatSession<br/>idempotent]
    B -- no --> D[TierRunner.run]
    C --> D

    D --> T1[TextTier.canHandle]
    T1 -- true --> T1E[TextTier.execute]
    T1E -- dumpsys + logcat match --> SUCCESS[SUCCESS]
    T1E -- no expectedLogcat<br/>+ !skipVerification --> T2E
    T1E -- no logcat session --> T2E
    T1E -- buffer empty --> T2E
    T1E -- some pattern missed --> FAIL[FAIL]

    T2E[UiAutomatorTier.execute] --> U{tapTarget?}
    U -- resourceId found --> TAPPED[Tap dispatched<br/>SUCCESS]
    U -- no resource-id match --> UFAIL[FAIL]
    U -- no tapTarget --> UDUMP[return hierarchy<br/>SUCCESS]
    U -- empty hierarchy --> T3E

    T3E[ScreenshotTier.execute] --> R{resize avail?}
    R -- yes --> J[540px JPEG<br/>q75 base64]
    R -- no --> P[raw PNG base64]
    J --> S3[SUCCESS]
    P --> S3

    SUCCESS --> OUT[atp_run_step response<br/>flattenTierResult]
    FAIL --> OUT
    UFAIL --> OUT
    TAPPED --> OUT
    UDUMP --> OUT
    S3 --> OUT
```

## Tier contracts

| Tier | canHandle | Can verify? | Can act (tap)? | Typical cost |
|------|-----------|-------------|---------------|--------------|
| TextTier | always (device reachable) | yes, via logcat pattern match | no | 1-2 dumpsys + 1 logcat scan |
| UiAutomatorTier | always (device reachable) | weak (element presence) | yes (resource-id or coords) | 1 uiautomator dump |
| ScreenshotTier | always | only via LLM vision | no | 1 screencap + resize |

## Result discriminated union

`TierResult` is a discriminated union keyed by `status`:

- `SUCCESS` — observation/verification/rawData optional
- `FAIL` — `verification` required
- `FALLBACK` — `fallbackHint` required; runner advances to the next tier
- `ERROR` — `error` required; runner short-circuits

The MCP server flattens this back to a plain object via `flattenTierResult`
so the wire format stays simple for the caller.

## Logcat session lifecycle

```
atp_run_step(expectedLogcat=[...]) ──► ensureLogcatSession()
                                         │
                                         ├─► existing && not expired  → reuse
                                         └─► start new (MAX_SESSIONS_PER_DEVICE=3)
```

Sessions are capped per device (3) and globally (50) to prevent fd/memory
exhaustion. Buffer is capped at 50k lines AND 64MB; overflow is reported via
`stopLogcat().bytesDropped`.

Lines returned by `atp_logcat_read` pass through a redaction filter that
strips bearer tokens, credentials, emails, and card-shaped digit strings
before they reach the agent context. Opt out with
`MOBILEMCP_DISABLE_REDACTION=1`.

## Shutdown

SIGTERM / SIGINT trigger a graceful drain — each child `adb logcat` process
gets SIGTERM then we await its `exit` event (bounded 2s per child) so the
last seconds of log output are flushed before `process.exit(0)`.
