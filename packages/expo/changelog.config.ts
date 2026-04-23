// changelogen config for @reprojs/expo (Expo SDK).
//
// Expo tags as `expo-v*` so it releases on a cadence independent of the
// dashboard (`v*`) and the web SDK (`sdk-v*`). changelogen has no `tagPrefix`
// option — every prefix-bearing string has to be overridden here.
// `syncGithubRelease` in changelogen also hardcodes `v${version}`, which is
// why the Expo GitHub Release is created from
// `.github/workflows/publish-expo.yml` instead of via changelogen's built-in
// `--github` step (disabled with --no-github in scripts/release-expo.sh).
export default {
  repo: "Ripwords/ReproJs",
  output: "CHANGELOG.md",
  templates: {
    commitMessage: "chore(release): expo-v{{newVersion}}",
    tagMessage: "expo-v{{newVersion}}",
    tagBody: "expo-v{{newVersion}}",
  },
}
