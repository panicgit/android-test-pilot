# Benchmark Harness

Measures tier hit ratio, latency, and ADB call count across canonical scenarios.
Produces a JSON report used as a regression baseline before/after each PR.

## Run

```bash
npm run bench                    # Run all scenarios, save to bench/results/
npm run bench -- --scenario login  # Run a single scenario
npm run bench -- --compare baseline.json  # Compare against a saved baseline
```

## Output

Each run writes `bench/results/run-{timestamp}.json`:

```json
{
  "version": "0.1.0",
  "timestamp": "2026-04-17T00:00:00Z",
  "scenarios": [
    {
      "name": "login",
      "totalSteps": 5,
      "tierBreakdown": { "text": 4, "uiautomator": 1, "screenshot": 0 },
      "tier1Ratio": 0.8,
      "avgStepLatencyMs": 320,
      "totalAdbCalls": 18,
      "estimatedVisionTokens": 0
    }
  ],
  "totals": { "tier1Ratio": 0.8, "tier2Ratio": 0.2, "tier3Ratio": 0.0 }
}
```

## Comparing Runs

A PR is considered a regression if `tier1Ratio` drops by more than 5% or
`avgStepLatencyMs` rises by more than 20% versus the saved baseline.

## Scenarios

Scenarios live in `bench/scenarios/*.json`. Each scenario lists a sequence of
synthetic steps with mocked ADB responses, so the harness runs without a
physical device. See `bench/scenarios/login.json` for an example.

This is offline mocked benchmarking. Real-device E2E benchmarks are tracked
separately and require an emulator.
