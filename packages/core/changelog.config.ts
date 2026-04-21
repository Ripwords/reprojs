// changelogen config for @reprojs/core (SDK).
//
// The SDK tags as `sdk-v*` so it can release on a cadence independent of the
// dashboard (which tags as `v*`). changelogen has no `tagPrefix` option —
// every prefix-bearing string has to be overridden here. `syncGithubRelease`
// in changelogen also hardcodes `v${version}`, which is why SDK GitHub
// Releases are created from `.github/workflows/publish-npm.yml` instead of
// via changelogen's built-in `--github` step (disabled with --no-github in
// scripts/release-sdk.sh).
export default {
  repo: "Ripwords/ReproJs",
  output: "CHANGELOG.md",
  templates: {
    commitMessage: "chore(release): sdk-v{{newVersion}}",
    tagMessage: "sdk-v{{newVersion}}",
    tagBody: "sdk-v{{newVersion}}",
  },
}
