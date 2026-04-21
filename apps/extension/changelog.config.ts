// changelogen config for @reprojs/extension (Chrome tester extension).
//
// The extension tags as `extension-v*` so it can release on a cadence
// independent of both the SDK (sdk-v*) and the dashboard (v*). changelogen
// has no `tagPrefix` option — every prefix-bearing template has to be
// overridden here, matching packages/core/changelog.config.ts. Without
// this, changelogen defaults to `v{{newVersion}}` for both the commit
// message and the tag; the tag creation then collides with an existing
// dashboard `v*` tag and release-extension.sh leaves the repo in a
// half-committed state (version bump + CHANGELOG written, no actual
// extension-v* tag).
//
// The GitHub Release for each extension tag is created from
// .github/workflows/publish-extension.yml (changelogen's `--github` step
// hardcodes `v${version}` as the tag to look up, so it's disabled with
// --no-github in scripts/release-extension.sh).
export default {
  repo: "Ripwords/ReproJs",
  output: "CHANGELOG.md",
  templates: {
    commitMessage: "chore(release): extension-v{{newVersion}}",
    tagMessage: "extension-v{{newVersion}}",
    tagBody: "extension-v{{newVersion}}",
  },
}
