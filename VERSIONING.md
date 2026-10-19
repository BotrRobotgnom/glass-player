# Versioning

Format `A.B.C`, starting at **0.0.1**.

| Digit | When it changes | Example |
|---|---|---|
| **C** (last) | any ordinary update: fixes, tweaks, small improvements | 0.0.1 → 0.0.2 |
| **B** (middle) | a serious update: new features or substantial changes, not just fixes. C resets to 0 | 0.0.7 → 0.1.0, then 0.1.1, 0.1.2 … → 0.2.0 |
| **A** (first) | only when the author decides: the biggest milestones (first official release, a global redesign). B and C reset to 0 | 0.9.3 → 1.0.0 |

Rules:
- The version lives in `package.json` (the `version` field); everything else reads it from there. Change it with `npm version <new> --no-git-tag-version`.
- Every new version gets an entry in `CHANGELOG.md`, split into `### Added`, `### Changed` and `### Fixed` (only the parts that apply). The heading is exactly `## A.B.C`.
- The GitHub release description is built from that entry automatically when the tag is pushed. Versions that were never published are added below it, so nothing is lost when a release skips some.
- The version matches the git tag with a leading `v` (`v0.0.2`) and the GitHub release name.
- Versions are never skipped or reused: a published tag is not rewritten. If a mistake is found, the fix ships as the next version.

## Pre-releases

To give a test version to volunteers first: push the tag as usual, and on the draft release tick "Set as a pre-release" before publishing.
Users with Settings → Updates → "Pre-releases" on get it as an update; everyone else only sees it in the changelog with a "Pre-release" tag.
When the version is final, publish the next one (or a new release of the same code) as a normal release.
