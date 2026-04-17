# GitHub Actions workflow (to install manually)

This workflow file was prepared as part of Sprint 2 (O6) but cannot be pushed
via an OAuth token without the `workflow` scope. Move it into
`.github/workflows/` from a local clone (with a PAT that has the `workflow`
scope, or directly in the GitHub UI) to activate CI.

```bash
mkdir -p .github/workflows
cp docs/workflows-to-install/ci.yml .github/workflows/ci.yml
git add .github/workflows
git commit -m "Install CI workflow"
git push
```

Issue and PR templates are safe to push via OAuth — they are delivered in
the `.github/` folder alongside this one.

## What it does

- **ci.yml** — Test matrix Node 18/20/22 × Ubuntu/macOS. Builds, tests,
  runs the bench harness, and gates Tier-routing regressions against
  `bench/results/baseline.json`.

## Why no release workflow?

android-test-pilot is distributed exclusively via the Claude Code
marketplace — there is no npm publish step. Users install the plugin
with `/plugin` then `panicgit/android-test-pilot`; Claude Code clones the
repo and builds `lib/` via the `prepare` script in `package.json`.
