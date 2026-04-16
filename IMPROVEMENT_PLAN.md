# android-test-pilot 개선 작업 계획서

생성일: 2026-04-17
근거: 100개 토론 결과 (10 트랙 × 10 토픽)
목표: P0 → P1 → P2 순으로 단계적 개선, 각 sprint 종료 시 릴리즈 가능 상태 유지.

---

## 🎯 Sprint 0 — 사전 준비 (반나절)

### S0-1. 기준선 측정 harness 구축
**목적**: "80% 텍스트 처리" 주장(C1)을 실제 측정 가능하게 만들기. 모든 후속 변경의 회귀 테스트 기준이 됨.

**작업**:
1. `bench/scenarios/` 디렉토리 생성, 5개 canonical 시나리오 작성 (login, list-scroll, form-validation, deep-link, cold-start).
2. `bench/run-bench.ts` 작성 — 각 시나리오 N회 실행 후 tier hit ratio, 평균 지속시간, 토큰 사용량 집계.
3. `npm run bench` 스크립트 추가, 결과를 `bench/results/baseline-{date}.json`에 저장.
4. CI에 weekly bench 잡 추가 (이후 sprint).

**완료 기준**: `npm run bench` 실행 시 `{tier1Ratio: x.xx, tier2Ratio: x.xx, tier3Ratio: x.xx, avgDurationMs, totalAdbCalls}` 출력.

### S0-2. 작업 브랜치 전략
- `improvement/sprint-1` … `sprint-3` 브랜치
- 각 P0 항목당 별도 PR (squash merge)
- PR 템플릿에 "before/after metric" 필수

---

## 🔴 Sprint 1 — Blocker 해결 (1-2일, P0 8개)

### S1-1. C2 — TextTier "no-op SUCCESS" 제거 ⭐ 최우선
**문제**: `src/tiers/text-tier.ts:54-63` — `expectedLogcat` 비어있으면 dumpsys만으로 SUCCESS. 실제 verify 없음.

**파일**: `src/tiers/text-tier.ts`

**수정**:
```typescript
// BEFORE (line 54-63)
if (!expectedLogcat || expectedLogcat.length === 0) {
  return { tier: this.name, status: "SUCCESS", observation: ..., rawData: ... };
}

// AFTER
if (!expectedLogcat || expectedLogcat.length === 0) {
  // No assertions to verify — defer to next tier so the action can
  // actually be performed (TextTier cannot tap).
  return {
    tier: this.name,
    status: "FALLBACK",
    fallbackHint: "No expectedLogcat assertions; TextTier cannot verify or act. Delegate to UiAutomatorTier.",
    observation: observations.join("\n"),
    rawData: JSON.stringify({ activityInfo, windowInfo }),
  };
}
```

**호환성**: scenario에서 의도적으로 verify 없이 진행하려면 `step.skipVerification: true` 명시 필요. `TestStep` 타입에 `skipVerification?: boolean` 추가.

**테스트**:
- `test/text-tier.test.ts` 신규: empty `expectedLogcat` → `FALLBACK` 반환
- 기존 시나리오 회귀: bench 실행 후 tier1Ratio 변동 측정

**검증 기준**: 기존 통과 시나리오 중 dumpsys-only 의존 케이스 식별 + scenario 보정.

---

### S1-2. C8 — `atp_run_step` 자동 logcat session 시작
**문제**: 모델이 `atp_logcat_start` 호출 잊으면 step 1부터 무조건 Tier3 폴스루.

**파일**: `src/server.ts`, `src/android.ts`

**수정**:
1. `AndroidRobot`에 `ensureLogcatSession()` 추가:
```typescript
public ensureLogcatSession(tags: string[] = ["ATP_SCREEN", "ATP_RENDER", "ATP_API"]): LogcatSession {
  const existing = AndroidRobot.getSessionByDevice(this.deviceId);
  if (existing && Date.now() - existing.startTime < existing.maxDuration) {
    return existing;
  }
  return this.startLogcat(tags, 300);
}
```

2. `atp_run_step` 호출 진입부에서 호출:
```typescript
// server.ts atp_run_step 콜백 내 (line 957 근처)
const robot = getRobotFromDevice(device);
if (!isAndroidRobot(robot)) throw new ActionableError(...);
robot.ensureLogcatSession();  // ⬅ 추가
```

3. `expectedLogcat`이 빈 step에서는 session 시작 생략 (S1-1과 호환).

**테스트**:
- session 부재 → atp_run_step 호출 → 자동 시작 검증
- 기존 session 살아있음 → 재시작 안 함 검증

**검증 기준**: bench 시나리오에서 사용자가 `atp_logcat_start` 호출하지 않아도 tier1Ratio가 80% 이상 유지.

---

### S1-3. A1 — AppMap loading cwd-decoupling
**문제**: `loadAppMap()`이 매 step마다 `process.cwd()` 의존, 누락 시 silent empty.

**파일**: `src/server.ts`

**수정**:
```typescript
// 1. 모듈 스코프에 cached state 추가
let cachedAppMap: { map: AppMap; mtime: number } | null = null;

const resolveAppMapDir = (): string => {
  return process.env.ATP_PROJECT_ROOT
    ? path.join(process.env.ATP_PROJECT_ROOT, ".claude", "app-map")
    : path.join(process.cwd(), ".claude", "app-map");
};

const loadAppMap = (): { appMap: AppMap; warnings: string[] } => {
  const dir = resolveAppMapDir();
  const warnings: string[] = [];
  const navPath = path.join(dir, "navigation_map.mermaid");
  const apiPath = path.join(dir, "api_scenarios.json");
  const viewPath = path.join(dir, "view_state_map.json");

  for (const [name, p] of [["navigation_map", navPath], ["api_scenarios", apiPath], ["view_state_map", viewPath]] as const) {
    if (!fs.existsSync(p)) warnings.push(`Missing artifact: ${name} at ${p}. Run /atp:analyze-app first.`);
  }

  // Cache by latest mtime
  const mtime = Math.max(...[navPath, apiPath, viewPath].filter(fs.existsSync).map(p => fs.statSync(p).mtimeMs), 0);
  if (cachedAppMap && cachedAppMap.mtime === mtime) {
    return { appMap: cachedAppMap.map, warnings };
  }

  const appMap: AppMap = {
    navigationMap: fs.existsSync(navPath) ? fs.readFileSync(navPath, "utf-8") : "",
    apiScenarios: parseJsonSafe(apiPath, ApiScenariosSchema)?.apis ?? [],
    viewStateMap: parseJsonSafe(viewPath, ViewStateMapSchema)?.screens ?? [],
  };
  cachedAppMap = { map: appMap, mtime };
  return { appMap, warnings };
};
```

`parseJsonSafe`는 Zod safeParse + 에러 시 null 반환 + trace 경고 (T9 동시 해결).

**테스트**:
- artifact 없을 때 응답에 warning 포함되는지
- mtime 변경 시 캐시 무효화되는지

---

### S1-4. A5 — `atp_run_step` action/verification 분리
**문제**: Tier 2가 tap 후 verify 없이 SUCCESS 반환.

**파일**: `src/tiers/types.ts`, `src/tiers/uiautomator-tier.ts`, `src/tiers/text-tier.ts`, `src/tiers/tier-runner.ts`

**수정 방향**:
1. `TierResult`에 `actionResult?: { performed: boolean; method: string }` 추가.
2. `TierContext`에 `phase: "act" | "verify" | "act-and-verify"` 추가.
3. `TierRunner`를 두 단계로 호출:
   ```typescript
   // server.ts atp_run_step
   const actResult = await runner.run({ ...ctx, phase: "act" });
   const verifyResult = await runner.run({ ...ctx, phase: "verify", previousTierResult: actResult });
   return { actResult, verifyResult };
   ```
4. `TextTier`는 verify phase에서만 동작, `UiAutomatorTier`는 act phase에서 tap 처리 후 verify는 다음 tier에 위임.

**검증 기준**: tap-then-logcat-verify scenario에서 actionTier=uiautomator, verifyTier=text 결과 반환.

**난이도**: M — 신중하게 진행. 1주차에 도입, S1 종료 전 충분히 테스트.

---

### S1-5. A7 — Scenario JSON Schema + validator
**파일**: `schemas/scenario.schema.json` (신규), `src/scenario.ts` (신규), `src/server.ts`

**수정**:
1. JSON Schema 정의 (YAML frontmatter + steps 배열):
```yaml
---
name: "Login Flow"
prerequisites: ["app installed", "logged out state"]
---
- step: "Launch app"
  action: { type: "launch", packageName: "com.example.app" }
  expectedLogcat:
    - { tag: "ATP_SCREEN", pattern: "enter: LoginActivity" }
  verification: "LoginActivity foreground"
- step: "Tap login button"
  action: { type: "tap", resourceId: "btn_login" }
  expectedLogcat:
    - { tag: "ATP_API", pattern: "endpoint=POST /auth, status=200" }
```

2. `atp_validate_scenario(path)` MCP tool 추가 — 파싱 + 스키마 검증 + ATP_VIEW vs ATP_RENDER 같은 알려진 오타 감지.
3. `atp_run_scenario(path)` MCP tool 추가 — 서버측에서 scenario 실행 (옵션).

**검증 기준**: 잘못된 태그 사용 시 명확한 에러, valid scenario 100% 파싱.

---

### S1-6. O1 + O4 — 배포 blocker fix
**파일**: `package.json`, `LICENSE` (신규), `.npmignore` (신규)

**수정**:
```diff
// package.json
"files": [
  "lib",
- ".claude/skills",
+ "skills",
+ "LICENSE",
+ "CHANGELOG.md",
  "templates"
]
```

LICENSE 파일: Apache-2.0 전체 텍스트 + `Copyright 2026 panicgit` + mobile-mcp 원작자 NOTICE 보존.

`.npmignore` (defense-in-depth):
```
.claude/
.omc/
.mcp.json
docs/internal/design-request.md
PROGRESS.md
src/
test/
bench/
tsconfig.json
.gitignore
*.local.*
```

**검증**: `npm pack --dry-run`으로 tarball 내용 확인. skills/* 4개 디렉토리 포함 확인.

---

### S1-7. S3 — SSE 무인증 차단
**파일**: `src/index.ts`

**수정**:
```typescript
// BEFORE (line 13-26 근처)
const auth = process.env.MOBILEMCP_AUTH;
if (!auth) {
  console.warn("MOBILEMCP_AUTH not set — server is unauthenticated");
}

// AFTER
const auth = process.env.MOBILEMCP_AUTH;
if (program.opts().listen && !auth) {
  console.error(`
[FATAL] MOBILEMCP_AUTH must be set when --listen is used.
Generate a token: openssl rand -hex 32
Then: export MOBILEMCP_AUTH=<token>
  `);
  process.exit(1);
}
```

`MOBILEMCP_ALLOW_INSECURE_LISTEN=1`로만 우회 가능하게 (S9 동시).

---

### S1-8. S2 + S6 — DoS 방어 (session cap + regex 검증)
**파일**: `src/android.ts`, `src/server.ts`

**수정 1 — session cap**:
```typescript
const MAX_SESSIONS_PER_DEVICE = 3;
const MAX_GLOBAL_SESSIONS = 50;

public startLogcat(tags, durationSeconds): LogcatSession {
  const perDevice = [...activeSessions.values()].filter(s => s.deviceId === this.deviceId).length;
  if (perDevice >= MAX_SESSIONS_PER_DEVICE) {
    throw new ActionableError(`Device "${this.deviceId}" already has ${MAX_SESSIONS_PER_DEVICE} active logcat sessions. Stop existing sessions before starting new ones.`);
  }
  if (activeSessions.size >= MAX_GLOBAL_SESSIONS) {
    throw new ActionableError(`Global logcat session cap (${MAX_GLOBAL_SESSIONS}) reached.`);
  }
  // ...rest
}
```

**수정 2 — regex 검증**:
```typescript
// server.ts atp_run_step Zod schema
expectedLogcat: z.array(z.object({
  tag: z.enum(["ATP_SCREEN", "ATP_RENDER", "ATP_API"]),
  pattern: z.string().max(200).refine(p => {
    try { new RegExp(p); return true; } catch { return false; }
  }, "Invalid regex pattern"),
}))
```

**수정 3 — Worker timeout** (낙관적 → 후속 sprint로 이연 가능):
```typescript
// text-tier.ts: regex.test 호출에 5s timeout (Worker 사용 또는 RE2 같은 안전한 엔진)
```

---

### Sprint 1 종료 체크리스트
- [ ] `npm test` 모두 통과
- [ ] `npm run bench` 실행 후 baseline 대비 tier1Ratio 유지/개선
- [ ] `npm pack --dry-run` 검증 (skills 4개 포함, 내부파일 제외)
- [ ] CHANGELOG.md에 v0.1.1 entry 작성
- [ ] git tag v0.1.1

---

## 🟠 Sprint 2 — 구조 정리 (3-5일)

### S2-1. T1 + T4 — 타입 안전성 강화
**파일**: `src/server.ts`, `src/tiers/types.ts`

**T1 — `tool()` 제네릭화**:
```typescript
const tool = <S extends Record<string, z.ZodType>>(
  name: string, title: string, description: string,
  paramsSchema: S, annotations: ToolAnnotations,
  cb: (args: z.infer<z.ZodObject<S>>) => Promise<string>
) => { /* ... */ };
```

**T4 — `TierResult` discriminated union**:
```typescript
export type TierResult =
  | { tier: string; status: "SUCCESS"; observation: string; verification?: TierVerification; rawData?: string }
  | { tier: string; status: "FAIL"; observation: string; verification: TierVerification; rawData?: string }
  | { tier: string; status: "FALLBACK"; fallbackHint: string; observation?: string; rawData?: string }
  | { tier: string; status: "ERROR"; error: string };
```

→ 컴파일 에러 발생 지점 모두 narrow 추가.

### S2-2. T2 + T6 — 에러 핸들링 일관성
- 모든 `catch (error: any)` → `catch (error: unknown)` + `error instanceof Error` narrow
- `posthog().then()` → `void posthog()`
- `main().then()` → `main().catch(err => { console.error(err); process.exit(1); })`

ESLint 룰 추가: `no-explicit-any`, `@typescript-eslint/use-unknown-in-catch-callback-variable`.

### S2-3. H1 + H2 + H8 — 프로덕션 안정성
**H1 — graceful shutdown**:
```typescript
const cleanupAllSessions = async () => {
  const promises = [...activeSessions.values()].map(session => {
    clearTimeout(session.timer);
    session.process.kill("SIGTERM");
    return new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 2000);
      session.process.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  });
  await Promise.all(promises);
  activeSessions.clear();
};
process.on("SIGTERM", async () => { await cleanupAllSessions(); process.exit(0); });
process.on("SIGINT", async () => { await cleanupAllSessions(); process.exit(0); });
```

**H2 — byte cap**:
```typescript
const MAX_LOGCAT_BYTES = 64 * 1024 * 1024; // 64MB
// session에 bufferBytes 필드 추가, line push 시 누적 체크
```

**H8 — session cap**: S1-8에서 이미 구현.

### S2-4. C1 — Eval harness 정식 도입
S0-1 bench를 정식 eval suite로 격상:
- `bench/eval-suite.ts`: 50개 시나리오 자동 실행
- 결과를 README에 자동 갱신 (CI 잡)
- "80%" 문구를 측정값으로 교체 (예: "측정 기준 LoginFlow 시나리오에서 Tier1 처리율 87%")

### S2-5. P-track 빠른 승리 (Quick Wins)
- **P1** S · `canHandle` 모든 ADB ping 제거, `screenshot-tier`는 `return true`
- **P2** S · dumpsys 호출에 `| grep -E '...'` 추가 (on-device 필터)
- **P6** S · `Promise.all([getDumpsysActivity, getDumpsysWindow])` (T5 후 가능)
- **P7** S · `isScalingAvailable()` 모듈 상수 memoize
- **P8** S · ScreenshotTier에 540px JPEG q75 적용 (image-utils 재사용)
- **P9** S · regex 컴파일을 step 진입 시 1회로 hoist
- **P10** S · `TierRunner`+tier 인스턴스 모듈 스코프 hoist

각각 PR 1개씩, 통합 회귀 측정 (bench 비교).

### S2-6. T7 + T8 — 코드 중복 제거
- `DEVICE_SCHEMA` 상수 도입, 25곳 일괄 교체
- `getAndroidRobotFromDevice(deviceId): AndroidRobot` 헬퍼 도입, 5곳 교체

### S2-7. O2 + O3 + O5 + O6 — 배포 위생
- `git rm -r --cached lib/` + `.gitignore` 확인
- `.npmignore` 작성 (S1-6 연계)
- v0.1.0 직전 commit squash (orphan branch + force push) — **사전 백업 필수**
- `.github/workflows/ci.yml`: PR test
- `.github/workflows/release.yml`: tag push → `npm publish --provenance --access public`

### Sprint 2 종료 체크리스트
- [ ] strict TypeScript 컴파일 (no `any` in src/)
- [ ] ESLint clean
- [ ] bench: tier1Ratio 베이스라인 ±5% 이내, 평균 latency 30%+ 개선
- [ ] CI green on Linux + macOS
- [ ] v0.2.0 release

---

## 🟡 Sprint 3 — 깊이 있는 개선 (1-2주)

### S3-1. T5 + P5 — 비동기 ADB 전환 (Big bang)
**파일**: `src/android.ts`, 모든 caller

**전략**:
1. `adb()` 시그니처 변경: `Buffer` → `Promise<Buffer>`
2. `execFileSync` → `execFile` (promisify)
3. caller 모두 `await` 추가 (이미 async 함수 안)
4. 변경 범위 큼 — 별도 PR + 충분한 회귀 테스트

**기대 효과**: 이벤트루프 차단 해제, 진정한 동시성, P6 같은 `Promise.all` 가능.

### S3-2. A2 + A3 + A4 — Tier 시스템 리팩토링
- `PlatformAdapter` 인터페이스 도입 (Android/iOS 양쪽 구현)
- `LogcatSessionRegistry` DI 클래스로 추출
- `AbstractTier._robot` 캐시 제거, context로 전달

### S3-3. A6 + A8 + A9 — 모듈 분할
- `src/server.ts` 1000줄 → 도메인별 분할:
  - `src/mcp/server.ts`
  - `src/mcp/tool-factory.ts`
  - `src/mcp/device-router.ts`
  - `src/tools/mobile/{device,app,screen,recording}.ts`
  - `src/tools/atp/{dumpsys,logcat,run-step}.ts`
- `src/atp/logcat-session.ts` (android.ts에서 분리)
- `UPSTREAM.md` 작성 (mobile-mcp fork SHA, 패치 전략 명시)

### S3-4. A10 — 구조화된 트레이싱
- OpenTelemetry-style span 도입 (`@opentelemetry/api` 의존성)
- `ATP_TRACE_FILE` env로 JSONL export
- `tier_summary` 필드를 atp_run_step 응답에 포함

### S3-5. C5 — Snapshot Diff Tier (신규 기능)
**파일**: `src/tiers/snapshot-tier.ts` (신규)

- `pixelmatch` 의존성 추가
- `.claude/baselines/{step-id}.png` 관리
- `expectedSnapshot: "step-name"` scenario 필드 추가
- `/atp:rebaseline` 슬래시 커맨드 (신규)

### S3-6. C7 — ATP 로그 포맷 JSON 마이그레이션
- 기존 `key=value` 포맷 deprecation warning
- 신규 `Log.d("ATP_RENDER", JSON.stringify({screen: "Login", btnVisible: true}))` 권장
- `expectedLogcat` 스키마에 `where: { ... }` 구조 매칭 옵션 추가
- `check-logs` SKILL에 마이그레이션 가이드

### S3-7. C4 + C10 — Compose / Release Build 가이드
**파일**: `docs/instrumentation-guide.md` (신규)
- Proguard `assumenosideeffects` 가이드 (ATP_* keep)
- `BuildConfig.ATP_ENABLED` 패턴
- Compose `Modifier.semantics { testTagsAsResourceId = true; testTag = ... }` 가이드
- Timber 어댑터 예시
- ViewModel-side `LaunchedEffect` 로깅 패턴 (recomposition storm 회피)

`/atp:check-logs`에 R8 strip 검출 추가.

### S3-8. S8 — PII redaction
**파일**: `src/android.ts` `readLogcat`

```typescript
const REDACTION_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /(token|password|secret|api_key)\s*[:=]\s*\S+/gi,
  /[\w._%+-]+@[\w.-]+\.[A-Z]{2,}/gi, // emails
];

const redact = (line: string): string => {
  let redacted = line;
  for (const pattern of REDACTION_PATTERNS) redacted = redacted.replace(pattern, "[REDACTED]");
  return redacted;
};
```

`atp_logcat_read` 응답에 redaction 적용. opt-out: `MOBILEMCP_DISABLE_REDACTION=1`.

### S3-9. D1 + D2 + D3 — 문서 대대적 보강
- `examples/sample-app/` 작성 (소형 Login+Home Kotlin 앱) + 완성된 `.claude/app-map/*`
- README에 5분 quickstart + asciinema cast
- TROUBLESHOOTING.md (ADB ENOENT, USB unauth, 권한 거부 등)
- ARCHITECTURE.md (Mermaid 다이어그램으로 tier 의사결정 트리)
- CONTRIBUTING.md (custom Tier 작성 가이드)
- `docs/internal/design-request.md` → `docs/internal/`로 이동

### Sprint 3 종료 체크리스트
- [ ] iOS Tier 1 PoC (정직한 한계 표기)
- [ ] snapshot diff tier 동작 검증
- [ ] examples/sample-app 동작 검증
- [ ] eval-suite 결과 README 자동 업데이트
- [ ] v0.3.0 release

---

## 🔵 Sprint 4+ — 후속 (지속)

### 측정 기반 의사결정
- C3 (cost-based tier dispatch) — Sprint 3 측정 결과 기반으로 priority 모델 결정
- C6 (act+verify compose primitive) — A5 도입 후 자연스럽게 진화
- C9 (iOS extension) — 독립 sprint 또는 별도 contributor

### Skills DX 마무리
- DX1~10 모두 일괄 처리 (작은 Sprint 1개)
- MCP `resources://` 노출 (DX10)

### TS-track (테스트 커버리지)
- Sprint 1-3 진행하며 자연스럽게 추가
- 종료 시 80%+ branch coverage 목표

---

## 📊 측정 지표 (KPI)

| 지표 | Baseline (Sprint 0) | Sprint 1 목표 | Sprint 2 목표 | Sprint 3 목표 |
|---|---|---|---|---|
| Tier 1 hit ratio (login 시나리오) | 측정 후 기록 | +5% | +10% | +15% |
| Step 평균 latency | 측정 후 기록 | 동일 | -30% | -50% |
| Vision token / step (Tier 3 발생 시) | ~5000 | ~5000 | ~300 (P8) | ~300 |
| 통합 테스트 커버리지 | ~30% | 50% | 70% | 80% |
| Critical/High 보안 이슈 | 4개 | 0개 | 0개 | 0개 |
| 메모리 상한 보장 | 없음 | 64MB/session | 64MB/session | 64MB/session |

---

## ⚠️ 위험 관리

### High-risk 변경 (별도 PR + 충분한 검증)
1. **A5** (action/verification 분리) — Tier 시스템 의미론 변경
2. **T5/P5** (async ADB) — 모든 caller 영향
3. **A2** (PlatformAdapter) — iOS 코드와 얽힘
4. **O5** (commit squash) — 히스토리 파괴, 롤백 불가

### 롤백 전략
- 각 P0 PR 단위로 revert 가능하게 작은 단위 commit
- `git tag rollback-point-sprint-{N}` 생성
- bench 결과가 baseline -10% 이상 악화 시 자동 alert

### 의존성 순서
```
S1-1 (C2) ─┐
S1-2 (C8) ─┴→ S1-4 (A5) ─→ Sprint 2 모든 P-track
S1-3 (A1) ────→ S1-5 (A7)
S1-6 (배포 fix) ──독립──→ S2-7 (CI/CD)
S1-7,8 (보안) ──독립
```

---

## 다음 단계
1. 이 계획서에 대한 사용자 검토/수정
2. Sprint 0 (bench harness) 작업 착수
3. Sprint 1 PR 1개씩 순차 진행, 각 PR 단위로 user 승인

작성: Claude Code (Opus 4.7 1M)
