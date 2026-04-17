# GitHub Actions workflows (to install manually)

These two workflow files were prepared as part of Sprint 2 (O6) but cannot be
pushed via an OAuth token without the `workflow` scope. Move them into
`.github/workflows/` from a local clone (with a PAT that has `workflow`
scope, or directly in the GitHub UI) to activate CI/CD.

```bash
mkdir -p .github/workflows
cp docs/workflows-to-install/ci.yml      .github/workflows/ci.yml
cp docs/workflows-to-install/release.yml .github/workflows/release.yml
git add .github/workflows
git commit -m "Install Sprint-2 CI/CD workflows"
git push
```

Issue and PR templates are safe to push via OAuth — they are delivered in the
same commit as this folder.

## What they do

- **ci.yml** — Test matrix Node 18/20/22 × Ubuntu/macOS. Builds, tests,
  runs the bench harness, and gates Tier-1 regressions against
  `bench/results/baseline.json`. Also runs `npm pack --dry-run` and asserts
  required paths present / internal paths absent in the tarball.
- **release.yml** — Fires on `v*.*.*` tag push, verifies tag matches
  `package.json` version, publishes to npm with provenance attestations.
  Requires `NPM_TOKEN` repo secret.
