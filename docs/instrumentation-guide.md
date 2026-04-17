# ATP Instrumentation Guide

How to add `ATP_SCREEN` / `ATP_RENDER` / `ATP_API` logs to an Android
codebase so Tier 1 (text-tier) can verify test steps cheaply. Covers the
four common realities — Views, Jetpack Compose, release builds, and
Timber-based logging — plus the gotchas that silently break Tier 1.

---

## 1. Gate instrumentation with a BuildConfig flag

Debug builds ship logs; release builds strip them. That means production
deployments can't be tested with Tier 1 unless you opt in explicitly.

**app/build.gradle(.kts)**:

```kotlin
android {
    buildTypes {
        debug {
            buildConfigField("boolean", "ATP_ENABLED", "true")
        }
        release {
            // Default off; flip to true to run device tests against a
            // release build (e.g. pre-release staging APKs).
            buildConfigField("boolean", "ATP_ENABLED", "false")
        }
        create("atp") {
            // Dedicated QA build type — extends release, turns ATP on.
            initWith(getByName("release"))
            buildConfigField("boolean", "ATP_ENABLED", "true")
            matchingFallbacks += listOf("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }
}
```

Then every ATP log call looks like:

```kotlin
if (BuildConfig.ATP_ENABLED) {
    Log.d("ATP_SCREEN", "enter: ${this::class.simpleName}")
}
```

A one-line helper avoids the `if` noise:

```kotlin
// AtpLog.kt
object AtpLog {
    inline fun screen(block: () -> String) {
        if (BuildConfig.ATP_ENABLED) Log.d("ATP_SCREEN", block())
    }
    inline fun render(block: () -> String) {
        if (BuildConfig.ATP_ENABLED) Log.d("ATP_RENDER", block())
    }
    inline fun api(block: () -> String) {
        if (BuildConfig.ATP_ENABLED) Log.d("ATP_API", block())
    }
}
```

Usage:

```kotlin
AtpLog.screen { "enter: LoginActivity" }
AtpLog.api    { "apiResponse: endpoint=POST /auth, status=$status" }
```

The `inline` + lambda means the log-building string concatenation is also
elided on release builds when `ATP_ENABLED=false`.

---

## 2. Keep ATP tags through R8 / Proguard

By default, R8 strips `android.util.Log.d` calls entirely in release
builds (the typical `assumenosideeffects` recipe). Your ATP helper must
survive the strip pass. If you use the `AtpLog` object above, add:

**proguard-rules.pro**:

```
# Keep android-test-pilot instrumentation even when Log.d is stripped
-keep class com.yourpkg.AtpLog { *; }
-keepclassmembers class com.yourpkg.AtpLog { *; }

# Do NOT include Log.d in the assumenosideeffects list, or add:
# (uncomment only if you keep a separate strip rule for Log.d)
#-assumevalues class android.util.Log {
#    public static boolean isLoggable(java.lang.String, int) return true;
#}
```

If your codebase does strip `Log.d` globally (`-assumenosideeffects class
android.util.Log { public static *** d(...); }`), replace it with a more
specific rule that excludes the ATP tags. Easiest: call `Log.println`
inside `AtpLog` instead of `Log.d` to bypass the strip entirely:

```kotlin
object AtpLog {
    inline fun screen(block: () -> String) {
        if (BuildConfig.ATP_ENABLED) {
            android.util.Log.println(android.util.Log.DEBUG, "ATP_SCREEN", block())
        }
    }
    // ...
}
```

`Log.println` is not touched by the standard strip rules.

---

## 3. Jetpack Compose — no resource-id by default

Tier 2 (uiautomator) targets elements by `resource-id`. Compose does not
emit `resource-id` in the view hierarchy unless you opt in.

### 3.1 Global opt-in

Anywhere in your app's theme or root `setContent {}`:

```kotlin
@Composable
fun MyApp() {
    CompositionLocalProvider(
        LocalSemanticsProperties provides SemanticsPropertyKey("testTagsAsResourceId")
    ) {
        Modifier.semantics(properties = { testTagsAsResourceId = true })
        // content
    }
}
```

Actually the cleanest idiom is at each targettable element:

```kotlin
Button(
    onClick = { viewModel.login() },
    modifier = Modifier.semantics {
        testTagsAsResourceId = true
        testTag = "btn_login"
    }
) { Text("Log in") }
```

After this, `uiautomator dump` reports the button with
`resource-id="btn_login"`, and `tapTarget.resourceId = "btn_login"`
works in an `atp_run_step` call.

### 3.2 Render logs from Compose state — avoid the recomposition storm

Do NOT place `AtpLog.render { ... }` inside a composition body:

```kotlin
@Composable
fun LoginScreen(state: LoginState) {
    // ❌ logs every recomposition — can fire hundreds of times per second
    AtpLog.render { "renderState: screen=Login, btnEnabled=${state.btnEnabled}" }
    // ...
}
```

Use `LaunchedEffect(state)` so the log fires once per meaningful state
change:

```kotlin
@Composable
fun LoginScreen(state: LoginState) {
    LaunchedEffect(state.btnEnabled, state.isLoading) {
        AtpLog.render { "renderState: screen=Login, btnEnabled=${state.btnEnabled}, isLoading=${state.isLoading}" }
    }
    // UI...
}
```

For ViewModel-side state, log when the `StateFlow` emits:

```kotlin
class LoginViewModel : ViewModel() {
    val state: StateFlow<LoginState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            state.collect { s ->
                AtpLog.render { "renderState: screen=Login, btnEnabled=${s.btnEnabled}" }
            }
        }
    }
}
```

---

## 4. Timber adapter

If your app uses [Timber](https://github.com/JakeWharton/timber) and you
don't want to call `android.util.Log` directly, pipe ATP through Timber
with a dedicated tag tree:

```kotlin
// AtpLog.kt
object AtpLog {
    inline fun screen(block: () -> String) {
        if (BuildConfig.ATP_ENABLED) Timber.tag("ATP_SCREEN").d(block())
    }
    inline fun render(block: () -> String) {
        if (BuildConfig.ATP_ENABLED) Timber.tag("ATP_RENDER").d(block())
    }
    inline fun api(block: () -> String) {
        if (BuildConfig.ATP_ENABLED) Timber.tag("ATP_API").d(block())
    }
}
```

Timber in release builds typically omits `DebugTree` — instrumentation
only works if your custom tree forwards `ATP_*` tags to `Log.d`:

```kotlin
// AtpTree.kt (registered via Timber.plant(AtpTree()))
class AtpTree : Timber.Tree() {
    override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
        if (tag?.startsWith("ATP_") == true) {
            android.util.Log.println(priority, tag, message)
        }
    }
}
```

Plant it early in `Application.onCreate()`:

```kotlin
override fun onCreate() {
    super.onCreate()
    if (BuildConfig.ATP_ENABLED) Timber.plant(AtpTree())
}
```

---

## 5. ATP log format conventions

| Tag | Payload | Example |
|-----|---------|---------|
| `ATP_SCREEN` | Screen entry/transition | `enter: LoginActivity` |
| `ATP_RENDER` | Rendered state snapshot | `renderState: screen=Login, btnEnabled=true, isLoading=false` |
| `ATP_API` | HTTP response received | `apiResponse: endpoint=POST /auth, status=200, bodyLength=143` |

### PII rules

- **Never** log full response bodies (`body=$responseBody`) from
  `ATP_API`. Log `bodyLength=${body.length}` and structural fields
  instead. `atp_logcat_read` applies a best-effort redaction filter,
  but primary defense is at the log site.
- Omit user identifiers — `userId`, `email`, `session_id`, etc. from
  `ATP_RENDER` and `ATP_API`.

### Structured `ATP_RENDER` (optional, future-proof)

The current `key=value, key=value` format is parser-fragile (values
containing commas or `=` break it). If your team is starting fresh,
prefer single-line JSON:

```kotlin
AtpLog.render {
    JSONObject().apply {
        put("screen", "Login")
        put("btnEnabled", state.btnEnabled)
        put("isLoading", state.isLoading)
    }.toString()
}
```

android-test-pilot plans to support structured matching in a future
release — until then the regex-based `expectedLogcat.pattern` works for
both formats.

---

## 6. Verification

After adding instrumentation, verify coverage with the static analyzer:

```
/atp:check-logs
```

This reads `.claude/app-map/view_state_map.json` and `api_scenarios.json`
(from `/atp:analyze-app`) and reports screens/API call sites missing
ATP logs.

Then run a smoke-test scenario:

```
/atp:run-test scenarios/smoke.md
```

and check the `tier` field of every step's response. If all steps report
`tier: "text"` with `SUCCESS`, instrumentation is working.

If any step falls through to `tier: "uiautomator"` or `"screenshot"`
despite you providing `expectedLogcat`, inspect:

1. `BuildConfig.ATP_ENABLED` is true for the APK you installed
2. The `AtpLog` helper is not stripped by R8
3. The log actually fires (attach `adb logcat -s ATP_SCREEN ATP_RENDER ATP_API`
   and trigger the action manually)
4. The `expectedLogcat.pattern` actually matches the emitted string
   (use plain substrings like `"btnEnabled=true"` during bring-up)

---

## 7. Related docs

- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) — runtime failure modes
- [architecture.md](architecture.md) — tier dispatch flowchart and
  logcat session lifecycle
- [../templates/scenario.md](../templates/scenario.md) — scenario
  template that consumes these logs
