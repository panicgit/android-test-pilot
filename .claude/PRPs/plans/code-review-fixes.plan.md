# Plan: Code Review Team Session Fixes (H3 + M12)

## Summary
3명의 전문 리뷰어(Security, TypeScript, Architecture)가 발견한 HIGH 3개 + MEDIUM 12개 이슈를 6단계로 수정한다.

## User Story
As a developer, I want all code review issues resolved so that the codebase is secure, type-safe, and architecturally sound.

## Problem → Solution
코드 리뷰에서 보안(device 소유권 누락), 아키텍처(TierRunner dead code), 타입 안전성(as any 캐스트) 이슈 발견 → 6 Phase로 체계적 수정

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A (코드 리뷰 피드백)
- **PRD Phase**: N/A
- **Estimated Files**: 10

---

## Files to Change

| File | Action | Justification |
|------|--------|---------------|
| `src/server.ts` | UPDATE | H1 device 검증, H3 type predicate, M4 since min(0), M12 telemetry, M1 PostHog, atp_run_step 추가 |
| `src/android.ts` | UPDATE | M4 since 방어, M5 err:unknown |
| `src/tiers/abstract-tier.ts` | UPDATE | M7 동시성 문서화 |
| `src/tiers/text-tier.ts` | UPDATE | M8 void adb, M10 조건 간소화 |
| `src/tiers/uiautomator-tier.ts` | UPDATE | M8 void adb |
| `src/tiers/screenshot-tier.ts` | UPDATE | M8 void adb |
| `src/index.ts` | UPDATE | M3 SSE auth 경고 |
| `.claude/skills/atp/run-test/SKILL.md` | UPDATE | atp_run_step 도구 사용으로 변경 |
| `.claude/skills/atp/check-logs/SKILL.md` | UPDATE | M2 ATP_API body 로깅 경고 |
| `test/tier-runner.test.ts` | UPDATE | M9 non-null assertion 정리 |
| `.claude/PRPs/plans/android-test-pilot-architecture.plan.md` | UPDATE | M11 패키지명 통일 |
| `package.json` | NO CHANGE | @anthropic/android-test-pilot 유지 |

---

## Step-by-Step Tasks

### Task 1: Phase A — Security Fixes (H1, M4)
- **ACTION**: `atp_logcat_stop`에 device 소유권 검증 추가 + `since` 음수 방어
- **IMPLEMENT**:
  - `server.ts:893`: `atp_logcat_read`의 device 검증 패턴 복사 (session.deviceId !== device 체크)
  - `server.ts:859`: Zod 스키마에 `.min(0)` 추가
  - `android.ts` readLogcat: `Math.max(0, since ?? 0)` 방어 코드
- **VALIDATE**: `npm run build && npm test` 통과

### Task 2: Phase B — Type Safety (H3, M5, M6)
- **ACTION**: `isAndroidRobot` type predicate 도입 + err:unknown 수정
- **IMPLEMENT**:
  - `server.ts`에 helper 함수 추가: `function isAndroidRobot(robot: Robot): robot is AndroidRobot`
  - 4개 `atp_*` 도구에서 `"method" in robot` + `as AndroidRobot` → `isAndroidRobot()` 교체
  - `android.ts:575,594` dumpsys catch를 `err: unknown` + `instanceof Error` 패턴으로 변경
- **VALIDATE**: `npm run build && npm test` 통과

### Task 3: Phase C — TierRunner Integration (H2)
- **ACTION**: `atp_run_step` MCP 도구 추가하여 TierRunner를 실제로 사용
- **IMPLEMENT**:
  - `server.ts`에 `atp_run_step` 도구 등록
  - 입력: `{ device, action, verification, expectedLogcat?, tapTarget? }`
  - 내부: TierRunner 인스턴스화 → TextTier, UiAutomatorTier, ScreenshotTier 등록 → run(context) → TierResult 반환
  - appMap은 `.claude/app-map/` 파일에서 로드 (없으면 빈 구조체)
  - `/atp:run-test` SKILL.md 업데이트: `atp_run_step` 도구 사용 안내 추가
- **IMPORTS**: TierRunner, TextTier, UiAutomatorTier, ScreenshotTier, TierContext from tiers/
- **GOTCHA**: appMap 파일이 없어도 에러 없이 빈 구조체로 처리해야 함
- **VALIDATE**: `npm run build && npm test` 통과

### Task 4: Phase D — State & Cleanup (M7, M8, M10)
- **ACTION**: 동시성 문서화 + void adb ping + 중복 조건 간소화
- **IMPLEMENT**:
  - `abstract-tier.ts:23`: JSDoc에 "Single-threaded assumption" 명시
  - `text-tier.ts`, `uiautomator-tier.ts`, `screenshot-tier.ts`: canHandle에서 `void robot.adb(...)` 명시적 무시
  - `text-tier.ts:121`: `noneMatched &&` 제거, `logLines.length === 0`만 사용
- **VALIDATE**: `npm run build && npm test` 통과

### Task 5: Phase E — Fork Fixes (M1, M3, M12)
- **ACTION**: PostHog 키 환경변수화, 텔레메트리 이름 수정, SSE 경고
- **IMPLEMENT**:
  - `server.ts:113`: `const api_key = process.env.POSTHOG_API_KEY || "";` + 키 없으면 early return
  - `server.ts:119`: `Product: "mobile-mcp"` → `Product: "android-test-pilot"`
  - `index.ts`: SSE 모드에서 auth 토큰 없을 때 경고 로그 추가
- **GOTCHA**: PostHog 키가 없으면 telemetry 전체를 무시해야 함 (fetch 실행 안 함)
- **VALIDATE**: `npm run build && npm test` 통과

### Task 6: Phase F — Docs & Cleanup (M2, M9, M11)
- **ACTION**: ATP_API 보안 가이드 + 테스트 정리 + 패키지명 통일
- **IMPLEMENT**:
  - `check-logs/SKILL.md`: 응답 body 로깅 시 민감 데이터 주의 문구 추가, bodyLength 권장
  - `test/tier-runner.test.ts:233-235`: `!` assertion 대신 narrowing 개선
  - 설계 문서: `@atp/android-test-pilot` → `@anthropic/android-test-pilot` 통일
- **VALIDATE**: `npm run build && npm test` 통과

---

## Validation Commands

### Build
```bash
npm run build
```
EXPECT: Zero errors

### Tests
```bash
npm test
```
EXPECT: 11 tests pass, 0 fail

---

## Acceptance Criteria
- [ ] H1: atp_logcat_stop에 device 소유권 검증 있음
- [ ] H2: TierRunner가 atp_run_step 도구를 통해 실제 호출됨
- [ ] H3: isAndroidRobot type predicate 사용, as any/as AndroidRobot 캐스트 제거
- [ ] M1-M12: 모든 MEDIUM 이슈 해결
- [ ] 빌드 성공, 테스트 11개 통과
- [ ] 6개 커밋으로 분리, push 완료
