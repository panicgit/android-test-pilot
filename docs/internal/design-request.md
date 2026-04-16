# android-test-pilot 아키텍처 설계 요청

## 배경

이 문서는 `android-test-pilot` 프로젝트의 전체 아키텍처 설계를 요청하기 위해 작성되었다.
코드 구현 전에 설계를 완전히 확정하는 것이 목적이며, 설계 결과물은 별도 구현 단계에서 사용된다.

---

## 프로젝트 개요

Android 앱 테스트 자동화를 위한 도구.
Claude Code와 연동하여 소스코드 정적 분석부터 실제 디바이스 테스트 실행까지 자동화하는 오픈소스 도구.

### 기술 구성 (확정)

| 구성 요소 | 역할 | 비고 |
|-----------|------|------|
| Claude Code 슬래시 커맨드 (`.claude/commands/`) | 사용자 인터페이스, 워크플로우 오케스트레이터 | Step 0/1/2 트리거 |
| Claude Code 네이티브 기능 | 소스파일 읽기, bash 실행, 파일 쓰기 | 별도 MCP 서버 불필요 |
| mobile-mcp (포크) | Tier 3 스크린샷, Tier 2 accessibility tree 기반 UI 조작 + Tier 1 logcat streaming 추가 | Apache-2.0, 포크 후 수정 |

### 커스텀 MCP 서버를 만들지 않는 이유

Claude Code는 이미 파일 읽기, bash 실행, 파일 쓰기를 네이티브로 지원한다.
Step 0 정적 분석, Step 1 로그 삽입, Step 2 ADB 명령 실행 모두 Claude Code가 직접 처리 가능하다.
별도 MCP 서버를 만들면 오히려 복잡도만 높아진다.

### mobile-mcp 포크를 선택한 이유

- Apache-2.0 라이선스 → 수정 후 재배포 자유
- 이미 accessibility tree 기반 동작 구현되어 있음 (Tier 2에 해당)
- 스크린샷 fallback 구현되어 있음 (Tier 3에 해당)
- **추가할 것: Tier 1 logcat streaming** (현재 없음)
- Android 전용 기능 강화만 하면 됨 (iOS 코드는 그대로 유지)

### 지원 범위

- 플랫폼: Android 전용 (향후 iOS/Flutter/RN 확장 가능하도록 설계)
- 언어: Kotlin / Java
- 프로젝트 구조: 단일 모듈 / 멀티 모듈 모두 지원
- 프로젝트 루트: Claude Code의 현재 작업 디렉토리(cwd) 자동 감지

---

## 전체 실행 흐름 (확정)

```
Step 0 — 정적 분석 (앱 전체 맵 구축)
Step 1 — 로그 커버리지 확인 & 보강
         ↓
         이 둘은 Step 2의 필수 선작업이다.
         실행 타이밍은 사용자 책임이다 (자동 감지 없음).

Step 2 — 실제 디바이스 테스트 실행
         ↑
         실행 전에 Step 0/1 완료 여부를 반드시 확인한다.
         선작업 산출물 파일이 없으면 에러로 중단한다.
```

---

## Step 0 — 정적 분석 (확정)

세 가지 분석을 수행하고 각각 파일로 저장한다.

| 분석 항목 | 내용 | 산출물 |
|-----------|------|--------|
| 0-A. 화면 네비게이션 흐름 | `startActivity`, `nav_graph.xml` 파싱 | `navigation_map.mermaid` |
| 0-B. API 연결 & 응답 시나리오 | Retrofit interface 추출, ViewModel 호출 지점 + 성공/실패 분기 파악 | `api_scenarios.json` |
| 0-C. View 상태 매핑 | `visibility` 조건, LiveData/StateFlow observe 지점 추적 | `view_state_map.json` |

산출물 저장 위치:
```
{project_root}/.claude/app-map/
├── navigation_map.mermaid
├── api_scenarios.json
└── view_state_map.json
```

---

## Step 1 — 로그 커버리지 확인 & 보강 (확정)

### Step 1이 필수 선작업인 이유 (중요)

Step 2 Tier 1은 logcat으로 현재 화면 상태와 API 수신 데이터를 파악한다.
이를 위해 아래 두 가지 정보가 logcat에 찍혀야 한다:

1. **현재 렌더링 중인 View 상태**
   ```kotlin
   Log.d(TAG, "renderState: hasCard=$hasCard, amount=$amount, btnVisible=$isConfirmVisible")
   ```

2. **API에서 수신한 데이터**
   ```kotlin
   Log.d(TAG, "apiResponse: $response")
   ```

`dumpsys activity`나 `uiautomator dump`로는 현재 Activity 이름과 View 구조만 알 수 있다.
**API 수신 데이터는 logcat 외에 볼 수 있는 방법이 없다.**
따라서 Step 1에서 이 로그들을 소스코드에 미리 심어두는 것이 Step 2 Tier 1의 전제 조건이다.

### Step 1 분석 항목

| 분석 항목 | 내용 |
|-----------|------|
| 1-A. 화면 진입/전환 로그 | BaseActivity/BaseFragment 유무 확인 후 로그 추가 제안 (`onCreate`, `onResume`) |
| 1-B. 화면 상태(renderState) 로그 | Step 0-C visibility 조건값이 logcat에 찍히는지 확인 |
| 1-C. API 응답 로그 | Step 0-B API 호출 지점에서 응답 데이터가 logcat에 찍히는지 확인 |

### Step 1 동작 방식

1. 분석 후 부족한 곳 리포트
2. 개발자에게 추가 여부 확인 (Y/N)
3. Y → 코드 직접 삽입 / N → 스킵
4. PR 자동 생성 없음 (개발자 판단)

---

## Step 2 — 테스트 실행 (확정)

### Tier 구조 및 근거

| Tier | 도구 | 사용 조건 | 파악 가능한 정보 |
|------|------|-----------|----------------|
| Tier 1 | logcat streaming | 가장 먼저 시도 | 현재 화면, View 상태, **API 수신 데이터** |
| Tier 2 | uiautomator dump + accessibility tree | Tier 1으로 판단 불가 시 | 현재 렌더링된 View 구조, resource-id, bounds |
| Tier 3 | mobile-mcp 스크린샷 | 최후 수단 | 이미지 렌더링 검증, 예외 팝업 |

### Tier 1이 logcat streaming이어야 하는 이유 (확정)

아래 대안들을 검토했으나 모두 한계가 있다:

| 대안 | 한계 |
|------|------|
| `adb shell dumpsys activity` | 현재 Activity 이름만 파악 가능. View 상태, API 데이터 불가 |
| `adb shell dumpsys window` | 현재 포커스 윈도우만 파악 가능. 동일한 한계 |
| `adb logcat -d` (스냅샷) | API 수신 데이터는 볼 수 있으나 테스트 실행 중 실시간 화면 전환 감지 불가 |
| `uiautomator dump` | View 구조는 볼 수 있으나 API 수신 데이터 불가 |

**결론: API 수신 데이터를 실시간으로 파악하려면 logcat streaming이 유일한 방법이다.**

### Tier 2 세부 사항

- `uiautomator dump` + mobile-mcp accessibility tree 병행
- `resource-id` 기반 tap 우선 (해상도 무관, 멀티 디바이스 대응)
- 좌표 기반 tap은 fallback

### Tier 3 세부 사항

- mobile-mcp (포크) 사용
- 제거 불가, 항상 탑재 필수
- 사용 케이스: 이미지 렌더링 검증, 예상치 못한 팝업

### Step 2 실행 전 체크 (확정)

아래 파일이 모두 존재해야 Step 2를 실행할 수 있다:
```
.claude/app-map/navigation_map.mermaid
.claude/app-map/api_scenarios.json
.claude/app-map/view_state_map.json
```
하나라도 없으면 에러 메시지와 함께 중단한다.

---

## mobile-mcp 포크 수정 범위

원본 저장소: https://github.com/mobile-next/mobile-mcp
라이선스: Apache-2.0

| 항목 | 원본 | 포크 후 |
|------|------|---------|
| accessibility tree 기반 탐색 | ✅ 있음 | 유지 (Tier 2) |
| 스크린샷 fallback | ✅ 있음 | 유지 (Tier 3) |
| logcat streaming | ❌ 없음 | **신규 추가** (Tier 1) |
| Android resource-id 기반 tap 우선순위 | △ 미흡 | 강화 |
| iOS 코드 | ✅ 있음 | 그대로 유지 |

---

## 플러그인 구조 (mobile-mcp 포크에 적용)

### 플러그인이 필요한 위치

슬래시 커맨드(`.claude/commands/`)는 `.md` 파일 기반 프롬프트이므로 플러그인 개념이 적용되지 않는다.
플러그인 구조는 **mobile-mcp 포크**에 적용한다.

### 적용 대상: Tier 시스템

Step 2의 Tier 1/2/3 각각을 플러그인으로 설계한다.
새로운 Tier 전략을 추가하거나 기존 Tier를 교체할 수 있는 구조가 목표다.

```
mobile-mcp (포크)/
└── src/
    └── tiers/
        ├── base.ts          ← 플러그인 인터페이스 (AbstractTier)
        ├── logcat.ts        ← Tier 1: logcat streaming (신규)
        ├── uiautomator.ts   ← Tier 2: uiautomator dump + accessibility tree
        └── screenshot.ts    ← Tier 3: 스크린샷 (기존 코드 래핑)
```

### 플러그인 인터페이스 원칙

각 Tier 플러그인은 아래 두 가지 메서드를 반드시 구현한다:

```
canHandle(context) → boolean
  - 이 Tier로 현재 상황을 판단할 수 있는지 확인
  - 예: logcat에 필요한 로그가 찍히고 있는지, 디바이스가 연결되어 있는지

execute(action, context) → TierResult
  - 실제 동작 수행 (화면 상태 파악, tap, 검증 등)
  - 판단 불가 시 FALLBACK 신호 반환 → 다음 Tier로 위임
```

### Tier 전환 로직

```
run-test 실행
  └→ Tier 1 (logcat) canHandle() 확인
       ├→ True  → execute() 실행
       │           └→ FALLBACK 신호 시 → Tier 2로 위임
       └→ False → Tier 2로 바로 위임

  └→ Tier 2 (uiautomator) canHandle() 확인
       ├→ True  → execute() 실행
       │           └→ FALLBACK 신호 시 → Tier 3으로 위임
       └→ False → Tier 3으로 바로 위임

  └→ Tier 3 (screenshot) → 항상 실행 가능, 최후 수단
```

### 플러그인 등록 방식

하드코딩 목록 방식으로 시작한다 (오픈소스 초기 버전 단순함 우선):

```typescript
// tier-runner.ts
const TIERS = [
  new LogcatTier(),       // Tier 1
  new UiAutomatorTier(),  // Tier 2
  new ScreenshotTier(),   // Tier 3
]
```

외부 개발자가 커스텀 Tier를 추가하려면 이 목록에 직접 추가한다.
향후 설정 파일 기반 등록 방식으로 확장 가능하도록 설계는 열어둔다.

### 플러그인 구조를 적용하는 이유

- Tier 전략이 프로젝트마다 다를 수 있음 (logcat 로그가 없는 프로젝트, 특수한 디바이스 환경 등)
- 새로운 Tier 추가 시 기존 코드를 수정하지 않고 파일만 추가하면 됨
- 테스트 시 특정 Tier를 mock으로 교체하기 쉬움
- 향후 iOS/Flutter Tier 추가 시 동일한 인터페이스로 확장 가능

---

## 저장소 구조 (확정)

### 단일 저장소로 관리

슬래시 커맨드와 Tier 플러그인 코드(mobile-mcp 포크)를 **하나의 저장소**로 관리한다.

**이유:**
- MCP 플러그인으로 설치하면 슬래시 커맨드 + Tier 코드가 한 번에 설치됨
- 사용자가 저장소 하나만 클론하면 모든 것이 준비됨
- 슬래시 커맨드와 Tier 코드가 같은 버전으로 관리되어 불일치 없음

**설치 흐름:**
```bash
# 1. 저장소 클론
git clone https://github.com/xxx/android-test-pilot

# 2. claude_desktop_config.json에 MCP 등록
{
  "mcpServers": {
    "android-test-pilot": {
      "command": "npx",
      "args": ["/path/to/android-test-pilot"]
    }
  }
}

# 3. 완료 — 슬래시 커맨드 + Tier 플러그인 모두 사용 가능
```

**저장소 이름: `android-test-pilot` (확정)**
**npm 패키지명: `@atp/android-test-pilot` (확정)**

---

## 슬래시 커맨드 목록 (확정)

| 커맨드 | 역할 | 인자 |
|--------|------|------|
| `/atp:analyze-app` | Step 0 전체 실행 (0-A, 0-B, 0-C) | 없음 |
| `/atp:check-logs` | Step 1 전체 실행 (1-A, 1-B, 1-C) | 없음 |
| `/atp:run-test` | Step 2 테스트 실행 | 시나리오 파일 경로 |
| `/atp:app-map` | `.claude/app-map/` 산출물 요약 보기 | 없음 |

### `/atp:run-test` 사용 예시
```
/atp:run-test scenarios/login.md
/atp:run-test scenarios/payment/card_payment.md
```

---

## 시나리오 파일 (확정)

### 형식: 마크다운

자연어로 작성한다. Claude가 읽고 판단하는 구조이므로 YAML 같은 구조화된 형식보다 마크다운이 더 유연하고 작성이 쉽다.

### 템플릿 제공 방식

사용자가 시나리오를 어떻게 써야 하는지 알 수 있도록 템플릿을 저장소에 포함해 제공한다.
사용자는 템플릿을 복사해서 자기 프로젝트에 맞게 채운다.

템플릿 위치:
```
android-test-pilot/
├── .claude/
│   └── commands/
│       ├── atp:analyze-app.md
│       ├── atp:check-logs.md
│       ├── atp:run-test.md
│       └── atp:app-map.md
├── templates/
│   └── scenario.md        ← 시나리오 템플릿
└── README.md
```

### 템플릿이 필요한 이유

Step 1에서 심는 로그 포맷이 정해져 있다:
```kotlin
Log.d(TAG, "renderState: hasCard=$hasCard, amount=$amount")
Log.d(TAG, "apiResponse: $response")
```
시나리오 파일의 검증 조건이 이 로그 포맷과 연동되어야 하므로, 템플릿 없이 사용자가 자유롭게 작성하면 Tier 1 logcat 파싱과 매칭이 안 될 수 있다.

---

## 설계 요청 사항

### 요청 1. 전체 저장소 구조

단일 저장소 `android-test-pilot` 의 전체 디렉토리 구조를 설계해 주세요.
아래 두 가지 역할이 하나의 저장소 안에서 공존해야 합니다:

- 슬래시 커맨드 (`.claude/commands/*.md`)
- Tier 플러그인 코드 (mobile-mcp 포크, TypeScript)

대략적인 구조 (확정 아님, 설계를 통해 확정 필요):
```
android-test-pilot/
├── .claude/
│   └── commands/          ← 슬래시 커맨드 .md 파일들
├── src/
│   └── tiers/             ← Tier 플러그인 코드 (mobile-mcp 포크)
├── templates/
│   └── scenario.md        ← 시나리오 템플릿
├── package.json
└── README.md
```

### 요청 2. 슬래시 커맨드 설계

커맨드 목록은 확정되었으니, 각 커맨드의 구체적인 동작 방식을 설계해 주세요:
- 각 커맨드가 Claude Code에게 전달하는 프롬프트 구조 (예시 포함)
- `/run-test` 커맨드에서 시나리오 파일 경로 인자를 받아 처리하는 방식
- Step 0/1/2 간 데이터 전달 방식
- Step 2 실행 전 선작업 완료 여부 체크 로직

### 요청 2-1. 시나리오 템플릿 설계

`templates/scenario.md` 템플릿을 설계해 주세요:
- 템플릿에 포함되어야 할 섹션 구성
- Tier 1 logcat 파싱과 연동되는 검증 조건 작성 방법
- Step 1 로그 포맷(`renderState`, `apiResponse`)과 템플릿의 연결 방식
- 사용자가 채워야 할 부분과 고정 구조의 구분

### 요청 2-2. 플러그인 구조 설계 (mobile-mcp 포크)

Tier 플러그인 시스템을 설계해 주세요:
- `AbstractTier` 인터페이스 (TypeScript) — `canHandle()`, `execute()` 시그니처
- `canHandle()`이 판단하는 컨텍스트 데이터 구조 정의
- `execute()` 반환 타입 정의 (`TierResult` — 성공, 실패, FALLBACK 신호 포함)
- Tier 간 전환 로직을 담당하는 `TierRunner` 설계
- 외부 개발자가 커스텀 Tier를 추가하는 방법
- 향후 설정 파일 기반 등록 방식으로 확장할 수 있는 여지 확보 방법

### 요청 3. logcat streaming 설계

mobile-mcp 포크에 추가할 logcat streaming 기능을 설계해 주세요:
- ADB logcat streaming을 MCP 도구로 노출하는 인터페이스
- Step 1에서 심은 로그 태그/포맷 컨벤션
- streaming 시작/중단 타이밍
- 파싱 전략 (renderState, apiResponse 로그를 어떻게 구조화할지)

### 요청 4. Step 간 데이터 흐름

Step 0 → Step 1 → Step 2 간 데이터가 어떻게 전달되는지 설계해 주세요.
특히 아래 의존 관계를 명확히 해주세요:
- Step 1-B가 Step 0-C 결과에 의존
- Step 1-C가 Step 0-B 결과에 의존
- Step 2 Tier 1이 Step 1에서 심은 로그 포맷에 의존

### 요청 5. 오픈소스 사용자 온보딩

처음 사용하는 개발자가 설치하고 첫 테스트를 실행하기까지의 흐름을 설계해 주세요.
단일 저장소를 클론 후 MCP 등록하는 방식을 기준으로 작성해 주세요.

---

## 설계 결과물 형식

1. **저장소 구조** — 단일 저장소의 전체 디렉토리 트리, 파일별 역할 설명
2. **슬래시 커맨드 설계** — 커맨드 목록, 각 커맨드의 프롬프트 구조 예시
3. **플러그인 구조 설계** — `AbstractTier` 인터페이스, `TierResult` 타입, `TierRunner` 설계, 확장 방법
4. **logcat streaming 설계** — MCP 도구 인터페이스, 로그 포맷 컨벤션, 파싱 전략
5. **Step 간 데이터 흐름도** — 다이어그램 또는 표
6. **온보딩 흐름** — 설치부터 첫 테스트 실행까지 단계별
7. **결정 사항 요약** — 주요 결정과 근거를 표로 정리

---

## 제약 조건

- 구현 코드 작성 금지. 설계와 인터페이스만 작성할 것.
- 모든 설계 결정에는 근거를 명시할 것.
- 오버엔지니어링 경계: 오픈소스 초기 버전임을 감안해 단순함을 우선할 것.
- 향후 iOS/Flutter 확장을 막지 않는 구조일 것.
- mobile-mcp 포크 코드는 원본과의 diff를 최소화할 것 (upstream 머지 용이성 유지).
