import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2026-04-17",
  future: { compatibilityVersion: 5 },
  modules: ["@nuxt/ui", "@nuxt/fonts"],
  css: ["~/assets/css/tailwind.css"],
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
