// changelogen config for the dashboard release (root package.json, `v*` tags).
//
// Exists primarily to document that the dashboard and SDK share the repo but
// have independent release lines. changelogen's default templates already
// produce `v{{newVersion}}`, so no template overrides are needed here.
//
// `--from` must still be passed explicitly by the release script: changelogen
// calls `git describe --tags --abbrev=0`, which returns the most recent tag
// across ALL prefixes. A recently-cut sdk-v* tag would become the dashboard's
// "from" base otherwise — the v0.1.6 entry in CHANGELOG.md was corrupted this
// way (it compares sdk-v0.1.6...v0.1.6 instead of v0.1.5...v0.1.6).
export default {
  repo: "Ripwords/reprojs",
  output: "CHANGELOG.md",
}
