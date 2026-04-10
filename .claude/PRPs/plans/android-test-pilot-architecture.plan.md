# Plan: android-test-pilot Architecture Design

## Summary
Android 앱 테스트 자동화 오픈소스 도구의 전체 아키텍처 설계. Claude Code 슬래시 커맨드(정적 분석, 로그 보강, 테스트 실행)와 mobile-mcp 포크 기반 Tier 플러그인 시스템(logcat → uiautomator → screenshot)을 단일 저장소로 통합 설계한다.

## User Story
As an Android developer,
I want an automated testing tool that analyzes my app, ensures proper logging, and runs device tests using Claude Code,
So that I can validate app behavior without writing manual test scripts.

## Problem → Solution
수동 테스트 + 로그 부족으로 앱 상태 파악 불가 → Claude Code가 정적 분석(Step 0) → 로그 보강(Step 1) → 3-Tier 디바이스 테스트(Step 2) 자동 수행

## Metadata
- **Complexity**: XL (신규 프로젝트 전체 아키텍처)
- **Source PRD**: `design-request-for-opus.md`
- **PRD Phase**: 전체 설계 (구현 전 단계)
- **Estimated Files**: 20+ (설계 산출물)
- **Constraint**: 구현 코드 작성 금지. 설계와 인터페이스만.

---

## Research Findings (3개 병렬 리서치 결과)

### R1. mobile-mcp 원본 구조 (mobile-next/mobile-mcp)

| 항목 | 내용 |
|------|------|
| 언어 | TypeScript 95.3%, Apache-2.0 |
| SDK | `@modelcontextprotocol/sdk` 1.26.0 + `zod` ^4.1.13 |
| 핵심 패턴 | `Robot` 인터페이스 → `AndroidRobot`, `IosRobot`, `MobileDevice` 구현 |
| 도구 등록 | `server.registerTool(name, { inputSchema: zodShape }, handler)` |
| ADB 래핑 | `AndroidRobot` 클래스가 `adb shell` 명령 실행 |
| UI 트리 | `adb shell uiautomator dump` → `fast-xml-parser`로 XML 파싱 |
| 스크린샷 | `adb shell screencap` → optional `sharp` 리사이즈 → base64 |
| 전송 | stdio (기본) / SSE (--listen) |
| 주요 파일 | `server.ts` (도구등록), `robot.ts` (인터페이스), `android.ts` (ADB), `ios.ts` |

**포크 시 수정 최소화 전략**: 기존 `Robot` 인터페이스와 `AndroidRobot`에 logcat 메서드만 추가. 새 Tier 코드는 `src/tiers/` 디렉토리에 분리.

### R2. MCP SDK 패턴

| 항목 | 내용 |
|------|------|
| 프로덕션 SDK | `@modelcontextprotocol/sdk` v1.x (v2는 pre-alpha) |
| 서버 초기화 | `new McpServer({ name, version })` + `StdioServerTransport` |
| 도구 스키마 | inner Zod shape 객체 (z.object() 아님) |
| 응답 타입 | `{ type: "text", text }`, `{ type: "image", data, mimeType }` |
| 에러 처리 | `{ content: [...], isError: true }` |
| 스트리밍 | MCP에 true streaming 없음. progress notification 또는 start/stop 패턴 |
| 로깅 | `console.error()` only (stdout은 JSON-RPC) |
| Claude Code 연동 | `.mcp.json` (프로젝트) 또는 `~/.claude.json` (로컬). `claude_desktop_config.json` 아님 |
| 실행 | `npx -y android-test-pilot` (shebang `#!/usr/bin/env node`) |
| 출력 제한 | `MAX_MCP_OUTPUT_TOKENS` 기본 10,000 → logcat은 50,000 권장 |

### R3. Claude Code 슬래시 커맨드

| 항목 | 내용 |
|------|------|
| 권장 구조 | `.claude/skills/` (`.claude/commands/`는 레거시) |
| 파일 형식 | `SKILL.md` + YAML frontmatter |
| 인자 처리 | `$ARGUMENTS`, `$0`, `$1` 플레이스홀더 |
| 네임스페이스 | 서브디렉토리로 생성: `.claude/skills/atp/analyze-app/SKILL.md` → `/atp:analyze-app` |
| 번들 파일 참조 | `${CLAUDE_SKILL_DIR}` 변수 |
| 셸 인젝션 | `` ```! `` 블록으로 동적 컨텍스트 주입 |
| 주요 설정 | `allowed-tools`, `argument-hint`, `disable-model-invocation`, `context: fork` |

**설계 변경 사항**: 원본 요청서는 `.claude/commands/*.md`를 명시했으나, 현재 Claude Code는 `.claude/skills/`를 권장. 설계에서 skills 구조로 전환.

---

## 설계 1. 전체 저장소 구조

### 결정 근거

| 결정 | 근거 |
|------|------|
| 단일 저장소 | 슬래시 커맨드 + MCP 서버가 같은 버전으로 관리됨 |
| `.claude/skills/` 사용 | `.claude/commands/`는 레거시. skills가 frontmatter, 인자, 번들 파일 지원 |
| `src/tiers/` 분리 | mobile-mcp 원본 코드와 Tier 코드를 분리해 upstream diff 최소화 |
| `.mcp.json` 포함 | 프로젝트 스코프 MCP 등록으로 팀 공유 가능 |

### 디렉토리 트리

```
android-test-pilot/
├── .claude/
│   └── skills/
│       └── atp/                          # /atp: 네임스페이스
│           ├── analyze-app/
│           │   └── SKILL.md              # /atp:analyze-app — Step 0
│           ├── check-logs/
│           │   └── SKILL.md              # /atp:check-logs — Step 1
│           ├── run-test/
│           │   └── SKILL.md              # /atp:run-test — Step 2
│           └── app-map/
│               └── SKILL.md              # /atp:app-map — 산출물 요약
├── src/
│   ├── index.ts                          # CLI 진입점, MCP 서버 부트스트랩
│   ├── server.ts                         # MCP 도구 등록 (mobile-mcp 포크)
│   ├── robot.ts                          # Robot 인터페이스 (mobile-mcp 원본)
│   ├── android.ts                        # AndroidRobot — ADB 래퍼 (mobile-mcp 원본 + logcat 추가)
│   ├── ios.ts                            # IosRobot (mobile-mcp 원본, 수정 없음)
│   ├── mobile-device.ts                  # MobileDevice (mobile-mcp 원본)
│   ├── mobilecli.ts                      # mobilecli 래퍼 (mobile-mcp 원본)
│   ├── image-utils.ts                    # 이미지 유틸 (mobile-mcp 원본)
│   ├── logger.ts                         # 로깅 (mobile-mcp 원본)
│   ├── utils.ts                          # 유틸 (mobile-mcp 원본)
│   └── tiers/                            # ★ Tier 플러그인 시스템 (신규)
│       ├── types.ts                      # TierContext, TierResult, TierStatus 타입
│       ├── abstract-tier.ts              # AbstractTier 인터페이스
│       ├── tier-runner.ts                # TierRunner — Tier 체인 실행기
│       ├── logcat-tier.ts                # Tier 1: logcat streaming
│       ├── uiautomator-tier.ts           # Tier 2: uiautomator + accessibility tree
│       └── screenshot-tier.ts            # Tier 3: 스크린샷 (mobile-mcp 기존 코드 래핑)
├── templates/
│   └── scenario.md                       # 테스트 시나리오 템플릿
├── .mcp.json                             # 프로젝트 스코프 MCP 서버 등록
├── package.json
├── tsconfig.json
└── README.md
```

### 파일별 역할

| 파일 | 출처 | 역할 |
|------|------|------|
| `src/index.ts` | mobile-mcp 원본 수정 | CLI 진입점, stdio/SSE 전송 |
| `src/server.ts` | mobile-mcp 원본 수정 | 기존 도구 + Tier 도구 등록 |
| `src/robot.ts` | mobile-mcp 원본 수정 | `Robot` 인터페이스에 `getLogcat()` 추가 |
| `src/android.ts` | mobile-mcp 원본 수정 | `AndroidRobot`에 logcat 구현 추가 |
| `src/ios.ts` | mobile-mcp 원본 유지 | iOS 코드 그대로 유지 |
| `src/tiers/*.ts` | 신규 | Tier 플러그인 시스템 전체 신규 |
| `.claude/skills/atp/*/SKILL.md` | 신규 | 슬래시 커맨드 프롬프트 |
| `templates/scenario.md` | 신규 | 시나리오 작성 템플릿 |
| `.mcp.json` | 신규 | MCP 서버 등록 설정 |

### .mcp.json

```json
{
  "mcpServers": {
    "android-test-pilot": {
      "command": "npx",
      "args": ["-y", "@atp/android-test-pilot"],
      "env": {
        "MAX_MCP_OUTPUT_TOKENS": "50000"
      }
    }
  }
}
```

### package.json 핵심 필드

```json
{
  "name": "@atp/android-test-pilot",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "android-test-pilot": "./build/index.js"
  },
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsc && chmod 755 build/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.26.0",
    "zod": "^4.1.13",
    "fast-xml-parser": "^5.3.8",
    "commander": "^14.0.0"
  },
  "optionalDependencies": {
    "sharp": "^0.33.0"
  }
}
```

---

## 설계 2. 슬래시 커맨드

### 2-A. `/atp:analyze-app` — Step 0 정적 분석

**SKILL.md 설계**:

```yaml
---
name: analyze-app
description: "Android 앱 전체 정적 분석 — 네비게이션 맵, API 시나리오, View 상태 매핑 생성"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Glob Bash Write
---
```

**프롬프트 구조**:

```markdown
# Step 0: Android 앱 정적 분석

현재 프로젝트의 Android 소스코드를 분석하여 앱 전체 맵을 구축한다.
아래 세 가지 분석을 순서대로 수행하고, 각각 파일로 저장한다.

## 0-A. 화면 네비게이션 흐름 분석

분석 대상:
- `AndroidManifest.xml`의 Activity 선언
- 소스코드 내 `startActivity()`, `startActivityForResult()` 호출
- `nav_graph.xml`, `navigation/*.xml` 파일의 Fragment 전환
- `Intent` 생성 패턴

산출물: `{project_root}/.claude/app-map/navigation_map.mermaid`
형식: Mermaid flowchart (Activity/Fragment 간 전환 관계)

## 0-B. API 연결 & 응답 시나리오 분석

분석 대상:
- Retrofit `@GET`, `@POST`, `@PUT`, `@DELETE` 어노테이션이 있는 interface
- 각 API를 호출하는 ViewModel/Repository 지점
- 성공(onSuccess)/실패(onError) 분기 코드

산출물: `{project_root}/.claude/app-map/api_scenarios.json`
형식:
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

## 0-C. View 상태 매핑 분석

분석 대상:
- `View.VISIBLE`, `View.GONE`, `View.INVISIBLE` 조건문
- `LiveData.observe()`, `StateFlow.collect()` 지점
- `DataBinding` 표현식 (`@{viewModel.isLoading}`)
- RecyclerView 어댑터의 데이터 바인딩

산출물: `{project_root}/.claude/app-map/view_state_map.json`
형식:
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

## 실행 규칙

1. `{project_root}/.claude/app-map/` 디렉토리를 생성한다.
2. 0-A, 0-B, 0-C를 순서대로 실행한다.
3. 각 분석 완료 시 해당 파일을 저장한다.
4. 모든 분석 완료 후 요약을 출력한다.
```

### 2-B. `/atp:check-logs` — Step 1 로그 커버리지 확인 & 보강

**SKILL.md 설계**:

```yaml
---
name: check-logs
description: "Step 0 산출물 기반으로 logcat 로그 커버리지 확인 및 보강 제안"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Glob Bash Write Edit
---
```

**프롬프트 구조**:

```markdown
# Step 1: 로그 커버리지 확인 & 보강

Step 0 산출물을 기반으로 logcat 로그가 충분한지 확인하고, 부족한 곳에 로그를 추가한다.

## 선행 조건 확인

아래 파일이 모두 존재하는지 확인한다:
- `.claude/app-map/navigation_map.mermaid`
- `.claude/app-map/api_scenarios.json`
- `.claude/app-map/view_state_map.json`

하나라도 없으면 아래 메시지를 출력하고 중단한다:
> ❌ Step 0 산출물이 없습니다. `/atp:analyze-app`을 먼저 실행하세요.

## 1-A. 화면 진입/전환 로그 확인

확인 대상:
- BaseActivity/BaseFragment가 있는지 확인
- 각 Activity/Fragment의 `onCreate()`, `onResume()`에 화면 진입 로그가 있는지 확인

로그 포맷 컨벤션:
```kotlin
Log.d("ATP_SCREEN", "enter: ${this::class.simpleName}")
```

없으면 추가 위치를 리포트한다.

## 1-B. 화면 상태(renderState) 로그 확인

확인 대상: `.claude/app-map/view_state_map.json`의 각 visibility 조건

각 화면에서 View 상태가 변경되는 지점에 아래 포맷의 로그가 있는지 확인:
```kotlin
Log.d("ATP_RENDER", "renderState: screen=${screenName}, ${conditionKey}=${conditionValue}, ...")
```

없으면 추가 위치를 리포트한다.

## 1-C. API 응답 로그 확인

확인 대상: `.claude/app-map/api_scenarios.json`의 각 API 호출 지점

각 API 응답 수신 지점에 아래 포맷의 로그가 있는지 확인:
```kotlin
Log.d("ATP_API", "apiResponse: endpoint=${endpoint}, status=${status}, body=${responseBody}")
```

없으면 추가 위치를 리포트한다.

## 동작 방식

1. 1-A, 1-B, 1-C 분석 후 부족한 곳을 리포트한다.
2. 각 항목에 대해 개발자에게 추가 여부를 확인한다 (Y/N).
3. Y → 코드에 직접 삽입한다.
4. N → 해당 항목을 스킵한다.
5. PR 자동 생성 없음 (개발자 판단).

## 로그 태그 컨벤션 (확정)

| 태그 | 용도 | 포맷 |
|------|------|------|
| `ATP_SCREEN` | 화면 진입/전환 | `enter: {ClassName}` |
| `ATP_RENDER` | View 상태 변경 | `renderState: screen={name}, {key}={value}, ...` |
| `ATP_API` | API 응답 | `apiResponse: endpoint={endpoint}, status={status}, body={body}` |
```

### 2-C. `/atp:run-test` — Step 2 테스트 실행

**SKILL.md 설계**:

```yaml
---
name: run-test
description: "시나리오 파일 기반 디바이스 테스트 실행 (Tier 1→2→3 자동 전환)"
disable-model-invocation: true
user-invocable: true
allowed-tools: Read Grep Glob Bash
argument-hint: <scenario-file-path>
---
```

**프롬프트 구조**:

```markdown
# Step 2: 테스트 실행

시나리오 파일을 읽고 실제 디바이스에서 테스트를 실행한다.

## 시나리오 파일

$ARGUMENTS

시나리오 파일 경로가 제공되지 않았으면 아래 메시지를 출력하고 중단한다:
> ❌ 시나리오 파일 경로를 지정하세요. 예: `/atp:run-test scenarios/login.md`

## 선행 조건 확인

아래 파일이 모두 존재하는지 확인한다:
- `.claude/app-map/navigation_map.mermaid`
- `.claude/app-map/api_scenarios.json`
- `.claude/app-map/view_state_map.json`

하나라도 없으면 에러 메시지와 함께 중단한다:
> ❌ Step 0/1 산출물이 없습니다. `/atp:analyze-app` → `/atp:check-logs`를 먼저 실행하세요.

## 테스트 실행 전략

시나리오 파일의 각 테스트 스텝에 대해:

### Tier 1 우선 시도 — logcat streaming
1. MCP 도구 `atp_logcat_start`로 logcat streaming 시작 (태그: ATP_SCREEN, ATP_RENDER, ATP_API)
2. MCP 도구 `atp_logcat_read`로 현재 로그 확인
3. 로그에서 현재 화면, View 상태, API 응답 데이터를 판단
4. 판단 가능하면 → 검증 수행
5. 판단 불가하면 → Tier 2로 위임

### Tier 2 — uiautomator + accessibility tree
1. MCP 도구 `mobile_list_elements_on_screen`으로 현재 UI 트리 덤프
2. `resource-id` 기반으로 요소 탐색 (해상도 무관)
3. 요소의 text, bounds, focused 상태로 판단
4. tap 필요 시 `resource-id` 기반 좌표 계산 → `mobile_click_on_screen_at_coordinates`
5. 판단 불가하면 → Tier 3로 위임

### Tier 3 — 스크린샷 (최후 수단)
1. MCP 도구 `mobile_take_screenshot`으로 스크린샷 캡처
2. 이미지를 분석하여 시각적 검증
3. 예상치 못한 팝업, 이미지 렌더링 확인

## 결과 출력

각 스텝의 결과를 표로 출력한다:
| Step | 기대 결과 | 실제 결과 | 사용 Tier | 판정 |
|------|----------|----------|----------|------|
```

### 2-D. `/atp:app-map` — 산출물 요약 보기

**SKILL.md 설계**:

```yaml
---
name: app-map
description: "Step 0 정적 분석 산출물 요약 보기"
user-invocable: true
allowed-tools: Read Glob
---
```

**프롬프트 구조**:

```markdown
# App Map 산출물 요약

`.claude/app-map/` 디렉토리의 산출물을 읽고 요약한다.

## 확인할 파일

```!
ls -la .claude/app-map/ 2>/dev/null || echo "산출물 없음"
```

파일이 없으면:
> 아직 분석을 실행하지 않았습니다. `/atp:analyze-app`을 실행하세요.

파일이 있으면 각 파일을 읽고 아래 형식으로 요약한다:

### 네비게이션 맵
- 총 화면 수, 주요 진입점, 화면 전환 관계 요약

### API 시나리오
- 총 API 수, 엔드포인트 목록, 성공/실패 분기 커버리지

### View 상태 맵
- 총 화면 수, 동적 상태가 있는 View 수, 데이터 소스 종류
```

---

## 설계 2-1. 시나리오 템플릿

### templates/scenario.md

```markdown
# 테스트 시나리오: {시나리오 이름}

## 개요
{이 시나리오가 검증하는 것을 1-2문장으로 설명}

## 전제 조건
- {앱이 설치되어 있어야 함}
- {특정 계정으로 로그인되어 있어야 함}
- {네트워크 연결 상태}

## 테스트 스텝

### Step 1: {화면 진입}
- **동작**: {앱을 실행하고 특정 화면으로 이동}
- **예상 logcat**:
  - `ATP_SCREEN` → `enter: {ActivityName}`
- **검증**:
  - 화면이 정상 로드됨

### Step 2: {사용자 입력}
- **동작**: {특정 필드에 값을 입력하고 버튼을 탭}
- **입력값**: {입력할 데이터}
- **탭 대상**: `resource-id: {btn_submit}`
- **예상 logcat**:
  - `ATP_RENDER` → `renderState: screen={ScreenName}, btnVisible=true, isLoading=false`
- **검증**:
  - 버튼이 활성화 상태여야 함

### Step 3: {API 호출 & 응답 확인}
- **동작**: {버튼 탭 후 API 호출 대기}
- **예상 logcat**:
  - `ATP_API` → `apiResponse: endpoint={GET /api/data}, status=200, body={...}`
  - `ATP_RENDER` → `renderState: screen={ScreenName}, hasData=true, listCount=5`
- **검증**:
  - API 응답 status가 200
  - 데이터가 화면에 반영됨 (hasData=true)

### Step 4: {시각적 검증 — Tier 3 필요 시}
- **동작**: {이미지가 포함된 화면의 렌더링 검증}
- **검증 방법**: 스크린샷
- **검증**:
  - 프로필 이미지가 렌더링됨
  - 레이아웃이 깨지지 않음

## 예상 결과
{전체 시나리오 성공 시 기대 상태}

## 실패 시 체크포인트
- {Step 2 실패 시: resource-id 확인}
- {Step 3 실패 시: API 엔드포인트 주소 확인}
- {Step 4 실패 시: 이미지 URL 접근 가능 여부 확인}
```

### 템플릿 — logcat 연동 규칙

| 시나리오 섹션 | 로그 태그 | 매칭 방식 |
|-------------|----------|----------|
| `예상 logcat: ATP_SCREEN` | `ATP_SCREEN` | `enter: {ClassName}` 문자열 포함 여부 |
| `예상 logcat: ATP_RENDER` | `ATP_RENDER` | `renderState:` 뒤의 key=value 쌍 파싱 |
| `예상 logcat: ATP_API` | `ATP_API` | `apiResponse:` 뒤의 endpoint, status, body 파싱 |

**파싱 전략**: Tier 1(logcat-tier.ts)이 로그 라인을 정규식으로 파싱:
```
ATP_SCREEN → /enter:\s*(\S+)/
ATP_RENDER → /renderState:\s*screen=(\w+),\s*(.+)/  → key=value 쌍 분리
ATP_API    → /apiResponse:\s*endpoint=(.+?),\s*status=(\d+),\s*body=(.*)/
```

---

## 설계 2-2. Tier 플러그인 구조

### AbstractTier 인터페이스

```typescript
// src/tiers/types.ts

/** Tier 실행에 필요한 컨텍스트 */
interface TierContext {
  /** ADB 디바이스 ID */
  deviceId: string;
  /** 현재 테스트 스텝 정보 */
  step: {
    action: string;
    expectedLogcat?: {
      tag: "ATP_SCREEN" | "ATP_RENDER" | "ATP_API";
      pattern: string;
    }[];
    tapTarget?: {
      resourceId?: string;
      coordinates?: { x: number; y: number };
    };
    verification: string;
  };
  /** Step 0 산출물 참조 */
  appMap: {
    navigationMap: string;      // mermaid 텍스트
    apiScenarios: ApiScenario[];
    viewStateMap: ViewStateScreen[];
  };
  /** 이전 Tier의 부분 결과 (있으면) */
  previousTierResult?: TierResult;
}

/** Tier 실행 결과 */
interface TierResult {
  /** 실행한 Tier 이름 */
  tier: string;
  /** 실행 상태 */
  status: TierStatus;
  /** 상태 판단 결과 (성공 시) */
  observation?: string;
  /** 검증 결과 (성공 시) */
  verification?: {
    passed: boolean;
    expected: string;
    actual: string;
  };
  /** 다음 Tier에 전달할 힌트 (FALLBACK 시) */
  fallbackHint?: string;
  /** 에러 메시지 (ERROR 시) */
  error?: string;
  /** 수집한 원시 데이터 */
  rawData?: string;
}

/** Tier 상태 */
type TierStatus =
  | "SUCCESS"      // 판단 완료, 검증 성공
  | "FAIL"         // 판단 완료, 검증 실패
  | "FALLBACK"     // 이 Tier로는 판단 불가, 다음 Tier로 위임
  | "ERROR";       // 실행 중 오류 발생
```

### AbstractTier 추상 클래스

```typescript
// src/tiers/abstract-tier.ts

abstract class AbstractTier {
  /** Tier 식별 이름 */
  abstract readonly name: string;

  /** Tier 우선순위 (낮을수록 먼저 실행) */
  abstract readonly priority: number;

  /**
   * 이 Tier로 현재 상황을 판단할 수 있는지 확인
   *
   * @param context - 현재 테스트 컨텍스트
   * @returns true이면 execute() 호출, false이면 다음 Tier로 건너뜀
   *
   * 판단 기준 예시:
   * - LogcatTier: logcat에 ATP_ 태그 로그가 실제로 찍히고 있는지
   * - UiAutomatorTier: 디바이스가 연결되어 있고 uiautomator가 응답하는지
   * - ScreenshotTier: 항상 true (최후 수단)
   */
  abstract canHandle(context: TierContext): Promise<boolean>;

  /**
   * 실제 동작 수행
   *
   * @param context - 현재 테스트 컨텍스트
   * @returns TierResult — SUCCESS, FAIL, FALLBACK, ERROR 중 하나
   *
   * FALLBACK 반환 시 TierRunner가 다음 Tier의 execute()를 호출한다.
   * fallbackHint에 "왜 이 Tier로 판단이 안 되었는지" 힌트를 담는다.
   */
  abstract execute(context: TierContext): Promise<TierResult>;
}
```

### TierRunner 설계

```typescript
// src/tiers/tier-runner.ts

class TierRunner {
  private tiers: AbstractTier[];

  constructor(tiers?: AbstractTier[]) {
    // 기본 Tier 목록 (하드코딩, 오픈소스 초기 버전 단순함 우선)
    this.tiers = tiers ?? [
      new LogcatTier(),       // priority: 1
      new UiAutomatorTier(),  // priority: 2
      new ScreenshotTier(),   // priority: 3
    ];

    // priority 기준 정렬
    this.tiers.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Tier 체인을 순서대로 실행
   *
   * 1. canHandle() 확인 → false면 다음 Tier로
   * 2. execute() 실행 → FALLBACK이면 다음 Tier로
   * 3. SUCCESS/FAIL/ERROR면 결과 반환
   * 4. 모든 Tier를 소진하면 ERROR 반환
   */
  async run(context: TierContext): Promise<TierResult> {
    // ... 체인 실행 로직 ...
  }

  /** 현재 등록된 Tier 목록 반환 (디버그/테스트용) */
  getTiers(): readonly AbstractTier[] {
    // ...
  }
}
```

### Tier 체인 실행 흐름

```
TierRunner.run(context)
  │
  ├─ Tier 1 (LogcatTier, priority=1)
  │   ├─ canHandle(context)
  │   │   ├─ true  → execute(context)
  │   │   │          ├─ SUCCESS/FAIL → 결과 반환 (종료)
  │   │   │          └─ FALLBACK     → fallbackHint 저장, 다음 Tier로
  │   │   └─ false → 다음 Tier로
  │   │
  ├─ Tier 2 (UiAutomatorTier, priority=2)
  │   ├─ canHandle(context)
  │   │   ├─ true  → execute(context)
  │   │   │          ├─ SUCCESS/FAIL → 결과 반환 (종료)
  │   │   │          └─ FALLBACK     → 다음 Tier로
  │   │   └─ false → 다음 Tier로
  │   │
  └─ Tier 3 (ScreenshotTier, priority=3)
      ├─ canHandle(context) → 항상 true
      └─ execute(context)
          ├─ SUCCESS/FAIL → 결과 반환 (종료)
          └─ ERROR → 에러 반환 (종료)

  모든 Tier 소진 시:
  → { tier: "none", status: "ERROR", error: "All tiers exhausted" }
```

### 각 Tier 구현 설계

**LogcatTier (Tier 1)**:
- `canHandle()`: `atp_logcat_read` 도구로 최근 로그 확인. ATP_ 태그 로그가 1줄 이상 있으면 true
- `execute()`: 시나리오 스텝의 `expectedLogcat` 패턴과 실제 로그를 매칭. 매칭되면 SUCCESS, 로그는 있지만 패턴 불일치면 FAIL, ATP_ 로그 자체가 없으면 FALLBACK

**UiAutomatorTier (Tier 2)**:
- `canHandle()`: `adb shell uiautomator dump` 실행 가능 여부 확인 (디바이스 연결 + 화면 ON)
- `execute()`: UI 트리 덤프 후 resource-id/text 기반 요소 탐색. tap 필요 시 resource-id 좌표 계산하여 tap. 요소 발견되면 SUCCESS, 없으면 FALLBACK

**ScreenshotTier (Tier 3)**:
- `canHandle()`: 항상 true (최후 수단)
- `execute()`: 스크린샷 캡처 후 이미지 분석. 항상 SUCCESS 또는 FAIL 반환 (FALLBACK 없음)

### 커스텀 Tier 추가 방법

```typescript
// 외부 개발자가 커스텀 Tier를 추가하는 방법:

// 1. AbstractTier를 상속하는 클래스 작성
class MyCustomTier extends AbstractTier {
  readonly name = "custom-network-monitor";
  readonly priority = 1.5;  // Tier 1과 2 사이에 삽입

  async canHandle(context: TierContext): Promise<boolean> { /* ... */ }
  async execute(context: TierContext): Promise<TierResult> { /* ... */ }
}

// 2. TierRunner 생성 시 포함
const runner = new TierRunner([
  new LogcatTier(),
  new MyCustomTier(),    // ← 추가
  new UiAutomatorTier(),
  new ScreenshotTier(),
]);
// priority 기준 자동 정렬됨
```

### 향후 설정 파일 기반 확장 여지

현재는 하드코딩이지만, 추후 `atp.config.json` 같은 설정 파일로 전환 가능:

```json
{
  "tiers": [
    { "module": "./tiers/logcat-tier.js", "enabled": true },
    { "module": "./tiers/uiautomator-tier.js", "enabled": true },
    { "module": "./tiers/screenshot-tier.js", "enabled": true }
  ]
}
```

이를 위해 `AbstractTier`를 인터페이스로 유지하고, `TierRunner` 생성자가 외부 주입을 받도록 설계했다. 현재 구조에서 설정 파일 전환 시 `TierRunner` 생성자만 수정하면 된다.

---

## 설계 3. logcat streaming

### MCP 도구 인터페이스

mobile-mcp 포크의 `server.ts`에 3개 도구를 추가한다:

| 도구명 | 역할 | 입력 | 출력 |
|--------|------|------|------|
| `atp_logcat_start` | logcat streaming 시작 | `{ deviceId?, tags?: string[], durationSeconds?: number }` | `{ sessionId: string }` |
| `atp_logcat_read` | 현재까지 수집된 로그 읽기 | `{ sessionId: string, since?: number }` | `{ lines: string[], lineCount: number }` |
| `atp_logcat_stop` | logcat streaming 중단 | `{ sessionId: string }` | `{ totalLines: number, durationMs: number }` |

### start/stop 패턴을 선택한 이유

MCP는 true streaming을 지원하지 않는다. 대안:

| 방식 | 장점 | 단점 |
|------|------|------|
| `adb logcat -d` (스냅샷) | 단순 | 실시간 감지 불가. 타이밍 미스 가능 |
| 단일 도구 + progress | 중간 경과 보고 가능 | durationSeconds 고정, 유연성 떨어짐 |
| **start/read/stop (세션)** | 유연한 타이밍, 필요할 때만 읽기 | 서버 상태 관리 필요 |

start/read/stop 세션 방식이 테스트 실행 흐름(동작 → 대기 → 로그 확인 → 다음 동작)에 가장 적합하다.

### 도구 입력 스키마 (Zod)

```typescript
// atp_logcat_start
{
  deviceId: z.string().optional().describe("ADB 디바이스 시리얼. 생략 시 첫 번째 연결 디바이스"),
  tags: z.array(z.string()).default(["ATP_SCREEN", "ATP_RENDER", "ATP_API"])
    .describe("필터링할 logcat 태그 목록"),
  durationSeconds: z.number().int().min(10).max(300).default(60)
    .describe("최대 스트리밍 시간 (초). 초과 시 자동 중단"),
}

// atp_logcat_read
{
  sessionId: z.string().describe("atp_logcat_start가 반환한 세션 ID"),
  since: z.number().int().optional().describe("이 라인 번호 이후의 로그만 반환 (증분 읽기)"),
}

// atp_logcat_stop
{
  sessionId: z.string().describe("중단할 세션 ID"),
}
```

### 내부 구현 설계 (인터페이스만)

```typescript
// src/android.ts — AndroidRobot에 추가할 메서드

interface LogcatSession {
  id: string;
  process: ChildProcess;        // adb logcat 프로세스
  buffer: string[];             // 수집된 로그 라인
  startTime: number;            // 시작 시각 (ms)
  maxDuration: number;          // 최대 시간 (ms)
  tags: string[];               // 필터 태그
  timer: NodeJS.Timeout;        // 자동 중단 타이머
}

// AndroidRobot에 추가할 메서드:
interface AndroidRobotLogcat {
  startLogcat(tags: string[], durationSeconds: number): LogcatSession;
  readLogcat(sessionId: string, since?: number): { lines: string[]; lineCount: number };
  stopLogcat(sessionId: string): { totalLines: number; durationMs: number };
}
```

### ADB 명령

```bash
# logcat streaming 시작 (tags 필터링)
adb -s {deviceId} logcat -v time ATP_SCREEN:D ATP_RENDER:D ATP_API:D *:S

# 필터 설명:
#   ATP_SCREEN:D — ATP_SCREEN 태그의 Debug 이상 레벨
#   ATP_RENDER:D — ATP_RENDER 태그의 Debug 이상 레벨
#   ATP_API:D    — ATP_API 태그의 Debug 이상 레벨
#   *:S          — 나머지 모두 Silent (숨김)
```

### 로그 태그/포맷 컨벤션 (확정)

Step 1에서 소스코드에 삽입하는 로그 형식:

```kotlin
// 화면 진입 — 1-A에서 삽입
Log.d("ATP_SCREEN", "enter: LoginActivity")
Log.d("ATP_SCREEN", "enter: HomeFragment")

// View 상태 — 1-B에서 삽입
Log.d("ATP_RENDER", "renderState: screen=LoginActivity, btnVisible=true, isLoading=false, errorMsg=null")
Log.d("ATP_RENDER", "renderState: screen=HomeFragment, hasCard=true, amount=50000, listCount=3")

// API 응답 — 1-C에서 삽입
Log.d("ATP_API", "apiResponse: endpoint=GET /api/users, status=200, body={\"users\":[...]}")
Log.d("ATP_API", "apiResponse: endpoint=POST /api/login, status=401, body={\"error\":\"invalid_password\"}")
```

### 파싱 전략

logcat-tier.ts가 수집된 로그 라인을 파싱하는 방식:

```
1. 라인 분리: buffer에서 줄 단위로 읽기
2. 태그 필터: 라인에서 태그(ATP_SCREEN/ATP_RENDER/ATP_API) 추출
3. 패턴 매칭:

   ATP_SCREEN:
     정규식: /enter:\s*(\S+)/
     추출: { screen: "LoginActivity" }

   ATP_RENDER:
     정규식: /renderState:\s*screen=(\w+),\s*(.*)/
     후처리: key=value 쌍을 Object로 변환
     추출: { screen: "LoginActivity", btnVisible: "true", isLoading: "false" }

   ATP_API:
     정규식: /apiResponse:\s*endpoint=(.+?),\s*status=(\d+),\s*body=(.*)/
     추출: { endpoint: "GET /api/users", status: 200, body: {...} }

4. 시나리오 스텝의 expectedLogcat과 비교하여 PASS/FAIL 판정
```

### streaming 시작/중단 타이밍

```
/atp:run-test 실행
  │
  ├─ atp_logcat_start (tags: ATP_SCREEN, ATP_RENDER, ATP_API)
  │   └─ logcat 프로세스 시작, 세션 ID 반환
  │
  ├─ 시나리오 Step 1 실행
  │   ├─ 동작 수행 (앱 실행, 화면 이동 등)
  │   ├─ atp_logcat_read (since: 0) → 로그 확인
  │   └─ 검증
  │
  ├─ 시나리오 Step 2 실행
  │   ├─ 동작 수행
  │   ├─ atp_logcat_read (since: lastLine) → 증분 로그 확인
  │   └─ 검증
  │
  ├─ ... 반복 ...
  │
  └─ atp_logcat_stop (세션 종료)
      └─ 전체 요약 반환
```

---

## 설계 4. Step 간 데이터 흐름

### 의존 관계 다이어그램

```
Step 0 정적 분석
├── 0-A: navigation_map.mermaid ──────────────────┐
├── 0-B: api_scenarios.json ────┐                  │
└── 0-C: view_state_map.json ──┼──┐               │
                                │  │               │
Step 1 로그 커버리지             │  │               │
├── 1-A: 화면 진입 로그 ────────┼──┼── navigation_map 참조
├── 1-B: renderState 로그 ─────┘  │
│         (0-C 의존)               │
├── 1-C: API 응답 로그 ───────────┘
│         (0-B 의존)
│
└── 소스코드에 ATP_ 태그 로그 삽입
                │
Step 2 테스트 실행
├── 선행 체크: 0-A + 0-B + 0-C 파일 존재 여부
├── Tier 1: logcat streaming ─── Step 1에서 삽입한 ATP_ 로그에 의존
├── Tier 2: uiautomator ──────── 0-C view_state_map 참조 (resource-id)
└── Tier 3: screenshot ────────── 독립적 (시각 검증)
```

### 데이터 흐름 상세

| 생산자 | 산출물 | 소비자 | 의존 내용 |
|--------|--------|--------|----------|
| Step 0-A | `navigation_map.mermaid` | Step 1-A | Activity/Fragment 목록 → 로그 삽입 위치 결정 |
| Step 0-B | `api_scenarios.json` | Step 1-C | API 엔드포인트 + 호출 지점 → 응답 로그 삽입 위치 결정 |
| Step 0-C | `view_state_map.json` | Step 1-B | View visibility 조건 → renderState 로그 삽입 위치 결정 |
| Step 0-A/B/C | 3개 파일 모두 | Step 2 선행 체크 | 파일 존재 여부만 확인 (내용 무관) |
| Step 1 | 소스코드 내 ATP_ 로그 | Step 2 Tier 1 | logcat streaming으로 실시간 수신 |
| Step 0-C | `view_state_map.json` | Step 2 Tier 2 | resource-id 기반 요소 탐색 힌트 |

### 파일 기반 전달 (선택한 방식)

Step 간 데이터 전달은 **파일 시스템**을 통해 이루어진다:

```
.claude/app-map/
├── navigation_map.mermaid   ← Step 0-A 생성, Step 1-A 읽기
├── api_scenarios.json       ← Step 0-B 생성, Step 1-C 읽기
└── view_state_map.json      ← Step 0-C 생성, Step 1-B 읽기
```

**이유**: Claude Code 슬래시 커맨드 간에는 메모리 공유가 없다. 각 커맨드는 독립 실행되므로, 파일이 유일한 데이터 전달 수단이다. 이 구조는 또한 사용자가 산출물을 직접 검토/수정할 수 있는 장점이 있다.

---

## 설계 5. 오픈소스 사용자 온보딩

### 설치부터 첫 테스트까지 (5단계)

```
[1] 저장소 클론
    ↓
[2] MCP 서버 등록
    ↓
[3] /atp:analyze-app 실행 (Step 0)
    ↓
[4] /atp:check-logs 실행 (Step 1)
    ↓
[5] 시나리오 작성 → /atp:run-test 실행 (Step 2)
```

### 단계별 상세

**[1] 저장소 클론 & 설치**

```bash
git clone https://github.com/xxx/android-test-pilot
cd android-test-pilot
npm install
npm run build
```

또는 npm 패키지로 설치 (게시 후):
```bash
npm install -g @atp/android-test-pilot
```

**[2] MCP 서버 등록**

방법 A — CLI (권장):
```bash
# 테스트 대상 Android 프로젝트 디렉토리에서 실행
cd /path/to/my-android-app
claude mcp add --transport stdio --scope project android-test-pilot -- npx -y @atp/android-test-pilot
```

방법 B — .mcp.json 직접 작성:
```bash
# 테스트 대상 프로젝트 루트에 .mcp.json 생성
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "android-test-pilot": {
      "command": "npx",
      "args": ["-y", "@atp/android-test-pilot"],
      "env": {
        "MAX_MCP_OUTPUT_TOKENS": "50000"
      }
    }
  }
}
EOF
```

**[3] 슬래시 커맨드 설치**

android-test-pilot 저장소의 `.claude/skills/atp/` 디렉토리를 테스트 대상 프로젝트에 복사:

```bash
cp -r /path/to/android-test-pilot/.claude/skills/atp /path/to/my-android-app/.claude/skills/atp
```

또는 심볼릭 링크:
```bash
ln -s /path/to/android-test-pilot/.claude/skills/atp /path/to/my-android-app/.claude/skills/atp
```

**[4] 디바이스 연결 확인**

```bash
adb devices
# List of devices attached
# emulator-5554  device
```

**[5] 첫 실행**

```
# Claude Code 시작
claude

# Step 0: 정적 분석
> /atp:analyze-app

# Step 1: 로그 커버리지 확인
> /atp:check-logs

# 시나리오 작성 (templates/scenario.md 복사 후 수정)
> cp /path/to/android-test-pilot/templates/scenario.md scenarios/login.md
> # 시나리오 편집...

# Step 2: 테스트 실행
> /atp:run-test scenarios/login.md
```

### 최소 요구사항

| 요구사항 | 버전 |
|---------|------|
| Node.js | >= 18 |
| ADB | Android SDK Platform-Tools |
| Claude Code | 최신 |
| Android 디바이스/에뮬레이터 | 연결 및 USB 디버깅 활성화 |

---

## 결정 사항 요약

| # | 결정 | 근거 |
|---|------|------|
| 1 | `.claude/skills/` 사용 (`.claude/commands/` 아님) | skills가 현재 Claude Code 권장 구조. frontmatter, 인자, 번들 파일 지원 |
| 2 | `.mcp.json` 사용 (`claude_desktop_config.json` 아님) | Claude Code는 `.mcp.json`(프로젝트) 또는 `~/.claude.json`(로컬) 사용 |
| 3 | logcat start/read/stop 세션 방식 | MCP에 true streaming 없음. 세션 방식이 테스트 흐름에 가장 유연 |
| 4 | 로그 태그 `ATP_` 접두사 | 다른 앱 로그와 충돌 방지, 필터링 용이 |
| 5 | `AbstractTier` + `TierRunner` 패턴 | Tier 교체/추가 용이, mock 테스트 가능, 향후 iOS/Flutter 확장 가능 |
| 6 | priority 기반 Tier 정렬 | 하드코딩 순서 대신 priority 값으로 정렬하면 커스텀 Tier 삽입이 자유로움 |
| 7 | 파일 기반 Step 간 데이터 전달 | 슬래시 커맨드 간 메모리 공유 없음. 파일이 유일한 수단이자 사용자 검토 가능 |
| 8 | `express` 제거 검토 | 원본 mobile-mcp는 SSE용으로 express 사용. stdio만 쓸 경우 불필요. 단, 원본과의 diff 최소화를 위해 유지 |
| 9 | `MAX_MCP_OUTPUT_TOKENS=50000` | logcat 출력이 기본 10,000 토큰을 초과할 수 있음 |
| 10 | 시나리오 파일은 마크다운 | Claude가 읽고 판단하는 구조이므로 YAML보다 자연어 마크다운이 유연 |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| logcat 로그가 없는 프로젝트에서 Tier 1 무력화 | High | Medium | Step 1 선행을 강제하고, Tier 2/3 fallback 보장 |
| mobile-mcp upstream 업데이트 시 머지 충돌 | Medium | Medium | 원본 파일 수정 최소화, 신규 코드는 `src/tiers/`에 분리 |
| MAX_MCP_OUTPUT_TOKENS 초과 | Medium | Low | logcat_read에서 since 파라미터로 증분 읽기 지원 |
| 시나리오 파일 포맷 미준수 | Medium | Low | 템플릿 제공 + 슬래시 커맨드에서 포맷 가이드 출력 |
| ADB 연결 불안정 | Low | High | 각 Tier의 canHandle()에서 디바이스 연결 상태 확인 |

---

## Step-by-Step Tasks (설계 산출물 작성)

### Task 1: 저장소 초기화
- **ACTION**: 디렉토리 구조 생성, package.json, tsconfig.json 작성
- **VALIDATE**: `npm install && npm run build` 성공

### Task 2: mobile-mcp 포크 코드 가져오기
- **ACTION**: mobile-mcp 원본 src/ 파일들을 가져오고, `robot.ts`에 logcat 인터페이스 추가
- **VALIDATE**: 기존 도구들이 정상 동작

### Task 3: Tier 타입/인터페이스 작성
- **ACTION**: `src/tiers/types.ts`, `src/tiers/abstract-tier.ts` 작성
- **VALIDATE**: 타입 체크 통과

### Task 4: TierRunner 구현
- **ACTION**: `src/tiers/tier-runner.ts` 체인 실행 로직
- **VALIDATE**: 단위 테스트로 FALLBACK 체인 검증

### Task 5: LogcatTier 구현
- **ACTION**: `src/tiers/logcat-tier.ts` + `server.ts`에 atp_logcat_start/read/stop 도구 등록
- **VALIDATE**: 에뮬레이터에서 logcat 스트리밍 테스트

### Task 6: UiAutomatorTier 구현
- **ACTION**: `src/tiers/uiautomator-tier.ts` — 기존 mobile-mcp 코드 래핑
- **VALIDATE**: UI 트리 덤프 + resource-id 기반 탐색 테스트

### Task 7: ScreenshotTier 구현
- **ACTION**: `src/tiers/screenshot-tier.ts` — 기존 스크린샷 코드 래핑
- **VALIDATE**: 스크린샷 캡처 테스트

### Task 8: 슬래시 커맨드 작성
- **ACTION**: `.claude/skills/atp/` 하위 4개 SKILL.md 작성
- **VALIDATE**: Claude Code에서 `/atp:` 자동완성 확인

### Task 9: 시나리오 템플릿 작성
- **ACTION**: `templates/scenario.md` 작성
- **VALIDATE**: 템플릿대로 작성한 시나리오를 `/atp:run-test`로 실행

### Task 10: .mcp.json & README 작성
- **ACTION**: 프로젝트 스코프 MCP 설정 + 온보딩 가이드
- **VALIDATE**: 클론 → 설치 → 첫 실행 플로우 검증

---

## Acceptance Criteria
- [ ] 저장소 구조가 확정되고 모든 파일 역할이 명확함
- [ ] 4개 슬래시 커맨드의 프롬프트 구조가 완성됨
- [ ] AbstractTier / TierResult / TierRunner 인터페이스가 정의됨
- [ ] logcat streaming의 start/read/stop MCP 도구 스키마가 정의됨
- [ ] Step 0→1→2 데이터 흐름과 의존 관계가 명확함
- [ ] 시나리오 템플릿과 logcat 파싱 연동 방식이 명확함
- [ ] 온보딩 플로우가 5단계로 문서화됨
- [ ] 모든 설계 결정에 근거가 명시됨

## Notes
- mobile-mcp 원본과의 diff를 최소화하기 위해, Tier 코드는 `src/tiers/`에 완전 분리하고 원본 파일 수정은 `robot.ts`(인터페이스 추가)와 `android.ts`(logcat 메서드 추가), `server.ts`(도구 등록)에만 한정한다.
- `express` 의존성은 원본 유지. SSE 모드를 제거하지 않음으로써 upstream 머지를 쉽게 한다.
- iOS 코드(`ios.ts`, `iphone-simulator.ts`, `webdriver-agent.ts`)는 일체 수정하지 않는다.
