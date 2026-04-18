import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2026-04-17",
  future: { compatibilityVersion: 5 },
  devtools: { enabled: process.env.NODE_ENV !== "production" },
  css: ["~/assets/css/tailwind.css"],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["better-auth/vue", "better-auth/client/plugins"],
    },
  },
  nitro: {
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      "*/1 * * * *": ["github:sync"],
    },
  },
  runtimeConfig: {
    betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
    mail: {
      provider: process.env.MAIL_PROVIDER ?? "ethereal",
      smtp: {
        host: process.env.SMTP_HOST ?? "",
        port: Number(process.env.SMTP_PORT ?? 587),
        user: process.env.SMTP_USER ?? "",
        pass: process.env.SMTP_PASS ?? "",
        from: process.env.SMTP_FROM ?? "Feedback Tool <no-reply@localhost>",
      },
    },
    public: {
      betterAuthUrl: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
      hasGithubOAuth: !!process.env.GITHUB_CLIENT_ID,
      hasGoogleOAuth: !!process.env.GOOGLE_CLIENT_ID,
    },
  },
})
