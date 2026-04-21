---
description: "Summarise the Step 0 artifacts produced by /atp:analyze-app. Read-only viewer — run /atp:analyze-app first."
allowed-tools: ["Read", "Glob", "Bash"]
argument-hint: "(no arguments; reads .claude/app-map/)"
---

# App Map Summary

Read and summarize the Step 0 analysis artifacts in `.claude/app-map/`.

## Check for artifacts

```!
ls -la .claude/app-map/ 2>/dev/null || echo "NO_ARTIFACTS"
```

If no artifacts found:
> No analysis results yet. Run `/atp:analyze-app` to generate them.

If artifacts exist, read each file and summarize:

### Navigation Map
- Total screen count
- Key entry points
- Screen transition relationships

### API Scenarios
- Total API count
- Endpoint list
- Success/error branch coverage

### View State Map
- Total screen count
- Number of Views with dynamic state
- Data source types (LiveData, StateFlow, DataBinding)
