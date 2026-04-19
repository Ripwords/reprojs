export default defineAppConfig({
  ui: {
    colors: {
      // Slate is a de-saturated cool-grey: it reads as "cool neutral with a
      // whisper of blue" rather than a hue, so `color="primary"` buttons
      // come out near-monochrome — professional, Linear/Sentry/Vercel feel,
      // no colored accent dominating the UI.
      primary: "zinc",
      // Zinc gives surfaces a clean cool-grey baseline. Paired with a
      // slate primary, the whole chrome reads as a single cool-neutral
      // scale rather than two competing hues.
      neutral: "mist",
    },
  },
})
