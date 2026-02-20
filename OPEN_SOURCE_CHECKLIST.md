# Open Source Release Checklist

## 1) Legal / Policy
- [ ] Final product name decision
- [x] License decision (MIT/Apache-2.0/etc)
- [x] Add `LICENSE`
- [ ] Third-party license notice if needed

## 2) Repo hygiene
- [x] Add README
- [x] Add architecture doc (`docs/architecture.md`)
- [x] Add roadmap (`docs/roadmap.md`)
- [ ] Remove internal-only logs/artifacts
- [ ] Ensure no secrets in git history

## 3) Community files
- [x] `CONTRIBUTING.md`
- [x] `CODE_OF_CONDUCT.md`
- [x] `SECURITY.md`
- [x] `SUPPORT.md` (optional)

## 4) GitHub templates
- [x] `.github/ISSUE_TEMPLATE/bug_report.yml`
- [x] `.github/ISSUE_TEMPLATE/feature_request.yml`
- [x] `.github/pull_request_template.md`

## 5) CI/CD
- [ ] Lint + typecheck + test GitHub Actions
- [x] Build check on PR
- [ ] Release workflow (tag -> release notes)

## 6) Developer Experience
- [x] `.env.example`
- [x] Setup script / docs
- [x] Test command documented
- [x] Conventional commit guide (optional)

## 7) Branding / docs
- [ ] Final naming applied in UI and docs
- [ ] Logo / favicon cleanup
- [ ] Screenshot + demo GIF for README

## 8) First public release
- [ ] v0.1.0 changelog
- [ ] Release notes
- [ ] Announcement post
