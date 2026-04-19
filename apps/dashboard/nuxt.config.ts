import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2026-04-17",
  future: { compatibilityVersion: 5 },
  modules: ["@nuxt/ui", "@nuxt/fonts", "nuxt-security"],
  css: ["~/assets/css/tailwind.css"],

  // Scan source at build time and bundle every `<UIcon>` / `i-*` reference
  // into the client JS. Without this, icons fall through to `@nuxt/icon`'s
  // `/api/_nuxt_icon/:collection.json?icons=*` runtime endpoint — which
  // crashes with `TypeError: Invalid URL` because our graph has both
  // `h3@1.15` (Nitro) and `h3@2.0.1-rc` (via @nuxt/telemetry → ofetch@2),
  // and @nuxt/icon 2.2.1's handler was compiled against h3 v2's Request
  // shape while the wrapping event is still h3 v1. Bundling at build time
  // sidesteps the broken server path entirely. The three `@iconify-json/*`
  // collections we installed (heroicons, lucide, simple-icons) feed this.
  icon: {
    clientBundle: {
      scan: true,
      includeCustomCollections: true,
    },
  },
  fonts: {
    families: [
      { name: "Geist", provider: "fontsource", weights: ["400", "500", "600", "700"] },
      { name: "JetBrains Mono", provider: "fontsource", weights: ["400", "500"] },
    ],
  },
  app: {
    head: {
      link: [
        {
          rel: "icon",
          type: "image/svg+xml",
          href: "/icon-light.svg",
          media: "(prefers-color-scheme: light)",
        },
        {
          rel: "icon",
          type: "image/svg+xml",
          href: "/icon-dark.svg",
          media: "(prefers-color-scheme: dark)",
        },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
        { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
        { rel: "manifest", href: "/manifest.webmanifest" },
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["better-auth/vue", "better-auth/client/plugins", "rrweb-player", "shiki"],
    },
  },
  experimental: { nitroAutoImports: true },
  nitro: {
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      "*/1 * * * *": ["github:sync"],
    },
    routeRules: {
      // Baseline security headers for every dashboard response.
      // - X-Frame-Options: DENY   → prevents the dashboard UI from being framed (clickjacking).
      //                             Safe for the intake API because it returns JSON, not embeddable HTML.
      // - X-Content-Type-Options  → disables MIME sniffing.
      // - Referrer-Policy         → avoids leaking full URLs to third-party origins.
      // HSTS is intentionally omitted here — it should be emitted by the terminating
      // reverse proxy (Caddy / Nginx / Cloudflare) where HTTPS actually terminates.
      // CSP is deferred — a correct policy requires a full inventory of every script/style
      // source and a too-strict policy breaks the app; too-permissive is security theater.
      "/**": {
        headers: {
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        },
      },
    },
  },
  runtimeConfig: {
    public: {
      betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      hasGithubOAuth: !!process.env.GITHUB_CLIENT_ID,
      hasGoogleOAuth: !!process.env.GOOGLE_CLIENT_ID,
    },
  },
})
