import { defineConfig } from "vitepress"

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Repro",
  description: "Framework-agnostic embeddable feedback SDK + self-hostable triage dashboard.",

  // Published to https://ripwords.github.io/ReproJs/
  base: "/ReproJs/",
  cleanUrls: true,
  lastUpdated: true,

  // docs/superpowers/* are historical plans + specs — not part of the site.
  srcExclude: ["superpowers/**", "**/README.md"],

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["meta", { name: "theme-color", content: "#10b981" }],
  ],

  themeConfig: {
    logo: { light: "/logo.svg", dark: "/logo-dark.svg" },

    nav: [
      { text: "Guide", link: "/guide/getting-started", activeMatch: "/guide/" },
      { text: "Self-host", link: "/self-hosting/", activeMatch: "/self-hosting/" },
      { text: "Develop", link: "/development/", activeMatch: "/development/" },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "Architecture", link: "/guide/architecture" },
          ],
        },
        {
          text: "SDK",
          items: [{ text: "Embed + API", link: "/guide/sdk" }],
        },
        {
          text: "Tester extension",
          items: [{ text: "Chrome extension", link: "/guide/extension" }],
        },
      ],
      "/self-hosting/": [
        {
          text: "Self-hosting",
          items: [
            { text: "Overview", link: "/self-hosting/" },
            { text: "Configuration", link: "/self-hosting/configuration" },
            { text: "Reverse proxy", link: "/self-hosting/reverse-proxy" },
            { text: "Storage", link: "/self-hosting/storage" },
            { text: "Integrations", link: "/self-hosting/integrations" },
            { text: "Operations", link: "/self-hosting/operations" },
            { text: "Compatibility", link: "/self-hosting/compatibility" },
          ],
        },
      ],
      "/development/": [
        {
          text: "Development",
          items: [{ text: "Overview", link: "/development/" }],
        },
      ],
    },

    socialLinks: [{ icon: "github", link: "https://github.com/Ripwords/ReproJs" }],

    editLink: {
      pattern: "https://github.com/Ripwords/ReproJs/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },

    search: { provider: "local" },

    footer: {
      message:
        'Released under the MIT License. · <a href="/ReproJs/privacy">Privacy policy</a>',
      copyright: "Copyright © 2026 JJ Teoh",
    },
  },
})
