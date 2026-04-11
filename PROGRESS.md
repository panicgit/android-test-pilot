# android-test-pilot 구현 진행 상황

> 마지막 업데이트: 2026-04-10

## 현재 상태: Phase 6 완료 (전체 구현 완료)

---

## Phase 로드맵

| Phase | 이름 | 상태 | 시작일 | 완료일 |
|-------|------|------|--------|--------|
| 0 | 설계 | **완료** | 2026-04-10 | 2026-04-10 |
| 1 | Foundation (기반) | **완료** | 2026-04-10 | 2026-04-10 |
| 2 | Tier Plugin System | **완료** | 2026-04-10 | 2026-04-10 |
| 3 | Logcat Streaming | **완료** | 2026-04-10 | 2026-04-10 |
| 4 | Tier Implementations | **완료** | 2026-04-11 | 2026-04-11 |
| 5 | Slash Commands & Scenario | **완료** | 2026-04-11 | 2026-04-11 |
| 6 | Onboarding & Release | **완료** | 2026-04-11 | 2026-04-11 |

---

## Phase 0: 설계 [완료]

- [x] design-request-for-opus.md 작성
- [x] 아키텍처 리서치 (mobile-mcp, MCP SDK, Claude Code skills) — 3개 병렬
- [x] 아키텍처 설계서 작성 → `.claude/PRPs/plans/android-test-pilot-architecture.plan.md`
- [x] Git 저장소 초기화

### 주요 설계 결정

| 결정 | 내용 |
|------|------|
| 슬래시 커맨드 | `.claude/skills/atp/` (commands가 아닌 skills 구조) |
| MCP 등록 | `.mcp.json` (claude_desktop_config.json 아님) |
| logcat 도구 | start/read/stop 3개 세션 방식 (MCP에 true streaming 없음) |
| 로그 태그 | `ATP_SCREEN`, `ATP_RENDER`, `ATP_API` |
| Tier 시스템 | AbstractTier + priority 기반 TierRunner |

---

## Phase 1: Foundation [완료]

- [x] package.json 생성 (`@anthropic/android-test-pilot`, CommonJS, bin: lib/index.js)
- [x] tsconfig.json 생성 (ESNext target, CommonJS module — mobile-mcp 원본과 동일)
- [x] 디렉토리 구조 생성 (src/, src/tiers/, templates/, .claude/skills/atp/)
- [x] mobile-mcp 포크 코드 가져오기 (13개 소스 파일)
- [x] 프로젝트명 브랜딩 변경 (server.ts, index.ts)
- [x] 의존성 설치 (122 packages, 0 vulnerabilities)
- [x] `npm run build` 성공 확인 (lib/ 에 38개 파일 생성)
- [x] .gitignore 생성

### Phase 1 결정 사항

| 결정 | 근거 |
|------|------|
| CommonJS 유지 (ESM 아님) | mobile-mcp 원본이 CommonJS. upstream diff 최소화 |
| outDir: `lib/` (build/ 아님) | mobile-mcp 원본과 동일한 출력 경로 |
| express 의존성 유지 | SSE 모드 유지로 upstream 머지 용이성 확보 |

---

## Phase 2: Tier Plugin System [완료]

- [x] src/tiers/types.ts — TierContext, TierResult, TierStatus, AppMap, TestStep 등 타입
- [x] src/tiers/abstract-tier.ts — AbstractTier 추상 클래스 (canHandle, execute)
- [x] src/tiers/tier-runner.ts — TierRunner 체인 실행기 (priority 정렬, FALLBACK 체인)
- [x] 단위 테스트: 11개 통과 (SUCCESS, FAIL, FALLBACK 체인, ERROR, 예외 처리, 빈 목록, priority 정렬, previousTierResult 전달)

---

## Phase 3: Logcat Streaming [완료]

- [x] src/android.ts — AndroidRobot에 logcat 세션 관리 추가 (startLogcat/readLogcat/stopLogcat)
- [x] src/android.ts — AndroidRobot에 dumpsys 메서드 추가 (getDumpsysActivity/getDumpsysWindow)
- [x] src/server.ts — 4개 MCP 도구 등록 (atp_dumpsys, atp_logcat_start/read/stop)
- [x] 기존 테스트 11개 통과 확인
- [ ] 에뮬레이터 E2E 테스트: ATP_ 태그 로그 수집 확인 (Phase 6에서 수행)

### Phase 3 설계 변경

| 변경 | 근거 |
|------|------|
| Robot 인터페이스 수정 안 함 | logcat/dumpsys는 Android 전용. iOS Robot에 불필요한 메서드 강제 방지 |
| atp_dumpsys 도구 추가 | Tier 1이 logcat 전용 → 텍스트 기반(dumpsys + logcat)으로 확장됨 |

---

## Phase 4: Tier Implementations [완료]

- [x] src/tiers/text-tier.ts — Tier 1 (dumpsys + logcat 파싱, FALLBACK 판단)
- [x] src/tiers/uiautomator-tier.ts — Tier 2 (UI 트리 덤프 + resource-id tap)
- [x] src/tiers/screenshot-tier.ts — Tier 3 (스크린샷 base64 캡처)
- [x] src/android.ts — getSessionByDevice() 정적 메서드 추가

---

## Phase 5: Slash Commands & Scenario [완료]

- [x] .claude/skills/atp/analyze-app/SKILL.md — Step 0 정적 분석
- [x] .claude/skills/atp/check-logs/SKILL.md — Step 1 로그 커버리지
- [x] .claude/skills/atp/run-test/SKILL.md — Step 2 테스트 실행 (3-tier)
- [x] .claude/skills/atp/app-map/SKILL.md — 산출물 요약
- [x] templates/scenario.md — 시나리오 템플릿 (영어)

---

## Phase 6: Onboarding & Release [완료]

- [x] .mcp.json — 프로젝트 스코프 MCP 등록
- [x] README.md — 영어 (설치, 설정, 사용법, 온보딩 가이드)
- [x] README.ko.md — 한국어 번역
- [x] npm publish 준비 완료 (bin, files, shebang)
- [ ] E2E 검증: 실제 디바이스 연결 후 전체 플로우 테스트 (별도 진행)

---

## 참조 문서

| 문서 | 경로 |
|------|------|
| 설계 요청서 | `design-request-for-opus.md` |
| 아키텍처 설계서 | `.claude/PRPs/plans/android-test-pilot-architecture.plan.md` |

## 비고

- mobile-mcp 원본과의 diff 최소화 원칙 유지
- iOS 코드 일체 수정 없음
- iOS 코드는 일체 수정하지 않음
