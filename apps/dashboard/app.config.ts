export default defineAppConfig({
  ui: {
    colors: {
      // Muted violet — used sparingly, Linear-style. Primary is only pulled
      // in when an action is genuinely the primary intent on the page;
      // most nav / interactive state uses neutral shades instead.
      primary: "violet",
      // Zinc is Tailwind's cool-neutral scale. Gives the surfaces a quiet
      // greyscale feel instead of the warmer stone tones we started with.
      neutral: "zinc",
    },
  },
})
