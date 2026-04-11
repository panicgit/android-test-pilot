---
name: analyze-app
description: "Android app static analysis — build navigation map, API scenarios, and View state map"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Glob Bash Write
---

# Step 0: Android App Static Analysis

Analyze the Android source code in the current project to build a complete app map.
Run all three analyses in order and save results to `.claude/app-map/`.

## 0-A. Screen Navigation Flow

Analyze:
- `AndroidManifest.xml` for Activity declarations
- Source code for `startActivity()`, `startActivityForResult()` calls
- `nav_graph.xml`, `navigation/*.xml` for Fragment transitions
- `Intent` creation patterns

Save to: `.claude/app-map/navigation_map.mermaid`
Format: Mermaid flowchart showing Activity/Fragment transition relationships.

## 0-B. API Connections & Response Scenarios

Analyze:
- Retrofit interfaces with `@GET`, `@POST`, `@PUT`, `@DELETE` annotations
- ViewModel/Repository call sites for each API
- Success (`onSuccess`) and error (`onError`) branches

Save to: `.claude/app-map/api_scenarios.json`
Format:
```json
{
  "apis": [
    {
      "endpoint": "GET /api/users",
      "interfaceFile": "UserApi.kt:15",
      "callers": [
        {
          "file": "UserViewModel.kt:42",
          "successHandler": "UserViewModel.kt:45-50",
          "errorHandler": "UserViewModel.kt:51-55"
        }
      ]
    }
  ]
}
```

## 0-C. View State Mapping

Analyze:
- `View.VISIBLE`, `View.GONE`, `View.INVISIBLE` conditions
- `LiveData.observe()`, `StateFlow.collect()` call sites
- DataBinding expressions (`@{viewModel.isLoading}`)
- RecyclerView adapter data binding

Save to: `.claude/app-map/view_state_map.json`
Format:
```json
{
  "screens": [
    {
      "name": "LoginActivity",
      "file": "LoginActivity.kt",
      "states": [
        {
          "viewId": "btn_login",
          "visibilityCondition": "isFormValid && !isLoading",
          "dataSource": "LoginViewModel.loginFormState",
          "sourceFile": "LoginActivity.kt:67"
        }
      ]
    }
  ]
}
```

## Execution Rules

1. Create `.claude/app-map/` directory if it doesn't exist.
2. Run 0-A, 0-B, 0-C in order.
3. Save each output file upon completion.
4. Print a summary of findings after all analyses complete.
