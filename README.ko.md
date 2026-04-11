# android-test-pilot

[English](README.md)

Android 앱 테스트 자동화 도구. Claude Code와 연동하여 소스코드 정적 분석부터 실제 디바이스 테스트 실행까지 자동화합니다.

## 왜 만들었는가

기존 mobile-mcp로 앱을 테스트하면 **스크린샷 촬영 → LLM 이미지 분석 → 다음 동작** 루프를 반복합니다. 이 방식은:

- **토큰 비용이 높습니다.** 매 스텝마다 스크린샷 이미지를 LLM에 보내야 합니다.
- **느립니다.** 스크린샷 캡처 + 이미지 전송 + 분석 대기가 매번 발생합니다.

android-test-pilot은 **텍스트 기반 ADB 명령을 1순위 정보 소스**로 사용하여 이 문제를 해결합니다.

```
기존 방식 (mobile-mcp):
  스크린샷 → LLM 이미지 분석 → 다음 동작 → 스크린샷 → ...
  (매 스텝 이미지 토큰 소모, 느림)

android-test-pilot:
  dumpsys + logcat 텍스트 → 즉시 판단 → 다음 동작 → ...
  (텍스트 기반, 빠르고 저렴)
  ↘ 판단 불가 시에만 uiautomator → 스크린샷 fallback
```

Tier 1은 `dumpsys activity`(현재 Activity), `dumpsys window`(포커스 윈도우), logcat(API 응답, View 상태)를 조합하여 앱 상태를 파악합니다. 모두 텍스트이므로 이미지 대비 토큰 소모가 극히 적고, 파싱도 즉시 가능합니다.  
스크린샷은 정말 필요할 때(이미지 렌더링 검증, 예외 팝업)만 Tier 3에서 사용합니다.

## 작동 방식

```
Step 0 — 정적 분석 (앱 전체 맵 구축)
Step 1 — 로그 커버리지 확인 & 보강
         ↓
         Step 2의 필수 선작업

Step 2 — 실제 디바이스 테스트 실행
         Tier 1: 텍스트 기반(dumpsys + logcat) → Tier 2: uiautomator → Tier 3: screenshot
```

### Step 0: 정적 분석

소스코드를 분석하여 앱의 전체 구조를 파악합니다.

| 분석 항목 | 산출물 |
|-----------|--------|
| 화면 네비게이션 흐름 | `navigation_map.mermaid` |
| API 연결 & 응답 시나리오 | `api_scenarios.json` |
| View 상태 매핑 | `view_state_map.json` |

### Step 1: 로그 커버리지 확인 & 보강

Step 0 결과를 기반으로, 테스트에 필요한 logcat 로그가 소스코드에 있는지 확인하고 부족한 곳에 추가합니다.

| 로그 태그 | 용도 | 예시 |
|-----------|------|------|
| `ATP_SCREEN` | 화면 진입/전환 | `enter: LoginActivity` |
| `ATP_RENDER` | View 상태 변경 | `renderState: screen=Login, btnVisible=true` |
| `ATP_API` | API 응답 | `apiResponse: endpoint=GET /api/users, status=200` |

### Step 2: 디바이스 테스트 실행

마크다운 시나리오 파일을 읽고 3-Tier 전략으로 테스트합니다.

| Tier | 도구 | 사용 조건 | 파악 가능한 정보 |
|------|------|-----------|----------------|
| Tier 1 | dumpsys + logcat (텍스트) | 가장 먼저 시도 | 현재 Activity, 포커스 윈도우, View 상태, API 수신 데이터 |
| Tier 2 | uiautomator + accessibility tree | Tier 1로 판단 불가 시 | 렌더링된 View 구조, resource-id, bounds |
| Tier 3 | 스크린샷 | 최후 수단 | 이미지 렌더링 검증, 예외 팝업 감지 |

## 설치

### 요구사항

- Node.js >= 18
- ADB (Android SDK Platform-Tools)
- Claude Code
- Android 디바이스 또는 에뮬레이터 (USB 디버깅 활성화)

### 설치 방법

```bash
git clone https://github.com/panicgit/android-test-pilot
cd android-test-pilot
npm install
npm run build
```

### MCP 서버 등록

테스트 대상 Android 프로젝트 디렉토리에서:

```bash
# CLI로 등록 (권장)
claude mcp add --transport stdio --scope project android-test-pilot \
  -- node /path/to/android-test-pilot/lib/index.js

# 또는 .mcp.json 직접 작성
cat > .mcp.json << 'EOF'
{
  "mcpServers": {
    "android-test-pilot": {
      "command": "node",
      "args": ["/path/to/android-test-pilot/lib/index.js"],
      "env": {
        "MAX_MCP_OUTPUT_TOKENS": "50000"
      }
    }
  }
}
EOF
```

### 슬래시 커맨드 설치

```bash
cp -r /path/to/android-test-pilot/.claude/skills/atp \
      /path/to/my-android-app/.claude/skills/atp
```

## 사용법

Claude Code에서 슬래시 커맨드로 실행합니다.

```bash
# 1. 정적 분석 (Step 0)
/atp:analyze-app

# 2. 로그 커버리지 확인 (Step 1)
/atp:check-logs

# 3. 시나리오 작성
cp /path/to/android-test-pilot/templates/scenario.md scenarios/login.md
# 시나리오 편집...

# 4. 테스트 실행 (Step 2)
/atp:run-test scenarios/login.md

# 산출물 요약 보기
/atp:app-map
```

## 시나리오 파일 작성

마크다운으로 자연어 테스트 시나리오를 작성합니다. `templates/scenario.md`를 참고하세요.

```markdown
# 테스트 시나리오: 로그인

## 테스트 스텝

### Step 1: 앱 실행
- **동작**: 앱을 실행하고 로그인 화면으로 이동
- **예상 logcat**:
  - `ATP_SCREEN` → `enter: LoginActivity`
- **검증**: 로그인 화면이 정상 로드됨

### Step 2: 로그인 시도
- **동작**: 이메일과 비밀번호 입력 후 로그인 버튼 탭
- **탭 대상**: `resource-id: btn_login`
- **예상 logcat**:
  - `ATP_API` → `apiResponse: endpoint=POST /api/login, status=200`
- **검증**: 홈 화면으로 전환됨
```

## 프로젝트 구조

```
android-test-pilot/
├── .claude/skills/atp/          # Claude Code 슬래시 커맨드
│   ├── analyze-app/SKILL.md     # /atp:analyze-app (Step 0)
│   ├── check-logs/SKILL.md      # /atp:check-logs (Step 1)
│   ├── run-test/SKILL.md        # /atp:run-test (Step 2)
│   └── app-map/SKILL.md         # /atp:app-map
├── src/
│   ├── index.ts                 # MCP 서버 진입점
│   ├── server.ts                # MCP 도구 등록
│   ├── android.ts               # AndroidRobot (ADB 래퍼)
│   ├── robot.ts                 # Robot 인터페이스
│   └── tiers/                   # Tier 플러그인 시스템
│       ├── types.ts             # TierContext, TierResult 타입
│       ├── abstract-tier.ts     # AbstractTier 추상 클래스
│       ├── tier-runner.ts       # TierRunner 체인 실행기
│       ├── text-tier.ts         # Tier 1: 텍스트 기반 (dumpsys + logcat)
│       ├── uiautomator-tier.ts  # Tier 2: UI 트리
│       └── screenshot-tier.ts   # Tier 3: 스크린샷
├── templates/
│   └── scenario.md              # 시나리오 템플릿
└── package.json
```

## MCP 도구

android-test-pilot은 5개의 MCP 도구를 제공합니다:

| 도구 | 설명 |
|------|------|
| `atp_run_step` | 단일 테스트 스텝을 3-tier 자동 전환으로 실행 (텍스트 → uiautomator → 스크린샷) |
| `atp_dumpsys` | 현재 Activity 또는 포커스 윈도우 조회 (텍스트 기반) |
| `atp_logcat_start` | ATP 태그 필터링으로 logcat 스트리밍 세션 시작 |
| `atp_logcat_read` | 활성 세션에서 수집된 로그 라인 읽기 (증분 읽기 지원) |
| `atp_logcat_stop` | logcat 세션 중단 및 통계 반환 |

기존 [mobile-mcp](https://github.com/mobile-next/mobile-mcp) 도구(`mobile_take_screenshot`, `mobile_list_elements_on_screen`, `mobile_click_on_screen_at_coordinates` 등)도 모두 사용 가능합니다.

## Tier 플러그인 확장

커스텀 Tier를 추가하여 테스트 전략을 확장할 수 있습니다.

```typescript
import { AbstractTier } from "./tiers/abstract-tier";
import { TierContext, TierResult } from "./tiers/types";

class MyCustomTier extends AbstractTier {
  readonly name = "custom-monitor";
  readonly priority = 1.5; // Tier 1과 2 사이에 삽입

  async canHandle(context: TierContext): Promise<boolean> {
    // 이 Tier를 사용할 수 있는지 확인
  }

  async execute(context: TierContext): Promise<TierResult> {
    // 테스트 실행 로직
  }
}
```

## 기술 기반

[mobile-mcp](https://github.com/mobile-next/mobile-mcp) (Apache-2.0)를 포크하여 Android 테스트 자동화에 특화했습니다.

| 구성 요소 | 역할 |
|-----------|------|
| Claude Code 슬래시 커맨드 | 사용자 인터페이스, 워크플로우 오케스트레이터 |
| Claude Code 네이티브 기능 | 소스 파일 읽기, bash 실행, 파일 쓰기 |
| mobile-mcp (포크) | 스크린샷, accessibility tree, logcat streaming |

## 라이선스

Apache-2.0
