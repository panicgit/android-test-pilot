# android-test-pilot

[한국어](README.ko.md)

Automated Android app testing tool. Integrates with Claude Code to automate everything from static source code analysis to real device test execution.

## Why This Exists

Testing apps with mobile-mcp means repeating a **screenshot → LLM image analysis → next action** loop. This approach is:

- **Expensive.** Every step sends a screenshot image to the LLM, consuming image tokens.
- **Slow.** Screenshot capture + image transfer + analysis adds latency at every step.

android-test-pilot solves this by using **text-based ADB commands as the primary information source**.

```
Conventional approach (mobile-mcp):
  screenshot → LLM image analysis → next action → screenshot → ...
  (image tokens every step, slow)

android-test-pilot:
  dumpsys + logcat text → instant parsing → next action → ...
  (text-based, fast and cheap)
  ↘ falls back to uiautomator → screenshot only when needed
```

Tier 1 combines `dumpsys activity` (current Activity), `dumpsys window` (focused window), and logcat (API responses, View state) to determine app state. All text — minimal token usage and instant parsing.  
Screenshots are only used in Tier 3 as a last resort (image rendering verification, unexpected popups).

## How It Works

```
Step 0 — Static Analysis (build app map)
Step 1 — Log Coverage Check & Augmentation
         ↓
         Prerequisites for Step 2

Step 2 — Device Test Execution
         Tier 1: text-based (dumpsys + logcat) → Tier 2: uiautomator → Tier 3: screenshot
```

### Step 0: Static Analysis

Analyzes source code to map the app's structure.

| Analysis | Output |
|----------|--------|
| Screen navigation flow | `navigation_map.mermaid` |
| API connections & response scenarios | `api_scenarios.json` |
| View state mapping | `view_state_map.json` |

### Step 1: Log Coverage Check & Augmentation

Based on Step 0 results, checks if the source code has the logcat logs needed for testing and adds missing ones.

| Log Tag | Purpose | Example |
|---------|---------|---------|
| `ATP_SCREEN` | Screen entry/transition | `enter: LoginActivity` |
| `ATP_RENDER` | View state change | `renderState: screen=Login, btnVisible=true` |
| `ATP_API` | API response | `apiResponse: endpoint=GET /api/users, status=200` |

### Step 2: Device Test Execution

Reads a markdown scenario file and runs tests using a 3-tier strategy.

| Tier | Tools | When Used | Detectable Info |
|------|-------|-----------|-----------------|
| Tier 1 | dumpsys + logcat (text) | Always tried first | Current Activity, focused window, View state, API response data |
| Tier 2 | uiautomator + accessibility tree | When Tier 1 can't determine | Rendered View hierarchy, resource-id, bounds |
| Tier 3 | Screenshot | Last resort | Image rendering, unexpected popup detection |

## Installation

### Requirements

- Node.js >= 18
- ADB (Android SDK Platform-Tools)
- Claude Code
- Android device or emulator (USB debugging enabled)

### Plugin Install (Claude Code marketplace)

Install as a Claude Code plugin — MCP server + slash commands all at once:

```
/plugin
```

When prompted, add the marketplace: `panicgit/android-test-pilot`, then:

```
/reload-plugins
```

Done. All `/atp:*` commands and MCP tools are ready.

android-test-pilot is distributed **exclusively** via the Claude Code
marketplace. There is no npm package. For local development on the tool
itself, clone the repo and run `npm install` — the `prepare` script
builds `lib/` automatically.

## Usage

Run via slash commands in Claude Code.

```bash
# 1. Static analysis (Step 0)
/atp:analyze-app

# 2. Log coverage check (Step 1)
/atp:check-logs

# 3. Write a scenario
cp /path/to/android-test-pilot/templates/scenario.md scenarios/login.md
# Edit the scenario...

# 4. Run test (Step 2)
/atp:run-test scenarios/login.md

# View analysis summary
/atp:app-map
```

## Writing Scenarios

Write test scenarios in natural-language markdown. See `templates/scenario.md` for the template.

```markdown
# Test Scenario: Login

## Test Steps

### Step 1: Launch App
- **Action**: Launch app and navigate to login screen
- **Expected logcat**:
  - `ATP_SCREEN` → `enter: LoginActivity`
- **Verify**: Login screen loaded successfully

### Step 2: Attempt Login
- **Action**: Enter email and password, tap login button
- **Tap target**: `resource-id: btn_login`
- **Expected logcat**:
  - `ATP_API` → `apiResponse: endpoint=POST /api/login, status=200`
- **Verify**: Navigated to home screen
```

## Project Structure

```
android-test-pilot/
├── .claude/skills/atp/          # Claude Code slash commands
│   ├── analyze-app/SKILL.md     # /atp:analyze-app (Step 0)
│   ├── check-logs/SKILL.md      # /atp:check-logs (Step 1)
│   ├── run-test/SKILL.md        # /atp:run-test (Step 2)
│   └── app-map/SKILL.md         # /atp:app-map
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── server.ts                # MCP tool registration
│   ├── android.ts               # AndroidRobot (ADB wrapper)
│   ├── robot.ts                 # Robot interface
│   └── tiers/                   # Tier plugin system
│       ├── types.ts             # TierContext, TierResult types
│       ├── abstract-tier.ts     # AbstractTier base class
│       ├── tier-runner.ts       # TierRunner chain executor
│       ├── text-tier.ts         # Tier 1: text-based (dumpsys + logcat)
│       ├── uiautomator-tier.ts  # Tier 2: UI hierarchy
│       └── screenshot-tier.ts   # Tier 3: screenshot
├── templates/
│   └── scenario.md              # Scenario template
└── package.json
```

## MCP Tools

android-test-pilot exposes 5 MCP tools for device interaction:

| Tool | Description |
|------|-------------|
| `atp_run_step` | Execute a single test step with automatic 3-tier fallback (text → uiautomator → screenshot) |
| `atp_dumpsys` | Query current Activity or focused Window (text-based) |
| `atp_logcat_start` | Start logcat streaming session with ATP tag filtering |
| `atp_logcat_read` | Read collected log lines from active session (supports incremental reads) |
| `atp_logcat_stop` | Stop logcat session and return stats |

All existing [mobile-mcp](https://github.com/mobile-next/mobile-mcp) tools (`mobile_take_screenshot`, `mobile_list_elements_on_screen`, `mobile_click_on_screen_at_coordinates`, etc.) are also available.

## Extending with Custom Tiers

Add custom Tiers to extend the testing strategy.

```typescript
import { AbstractTier } from "./tiers/abstract-tier";
import { TierContext, TierResult } from "./tiers/types";

class MyCustomTier extends AbstractTier {
  readonly name = "custom-monitor";
  readonly priority = 1.5; // Insert between Tier 1 and 2

  async canHandle(context: TierContext): Promise<boolean> {
    // Check if this Tier can handle the current step
  }

  async execute(context: TierContext): Promise<TierResult> {
    // Test execution logic
  }
}
```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common failure modes —
`adb not found`, empty device list, every step falling through to the
screenshot tier, missing `.claude/app-map/*` artifacts, and more.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the tier-dispatch
flowchart, result type contract, and logcat session lifecycle.

## Built On

Forked from [mobile-mcp](https://github.com/mobile-next/mobile-mcp) (Apache-2.0), specialized for Android test automation.

| Component | Role |
|-----------|------|
| Claude Code slash commands | User interface, workflow orchestrator |
| Claude Code native features | Source file reading, bash execution, file writing |
| mobile-mcp (fork) | Screenshots, accessibility tree, logcat streaming |

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE) for upstream
attribution.
