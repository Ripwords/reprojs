import { defineManifest } from "@crxjs/vite-plugin"
import pkg from "./package.json" with { type: "json" }

export default defineManifest({
  manifest_version: 3,
  name: "Repro Tester",
  description: "Inject the Repro SDK into configured origins for internal QA.",
  version: pkg.version,
  permissions: ["storage", "scripting", "activeTab", "tabs"],
  host_permissions: [],
  optional_host_permissions: ["<all_urls>"],
  background: {
    service_worker: "src/service-worker/index.ts",
    type: "module",
  },
  action: {
    default_popup: "index.html",
  },
  options_page: "options.html",
  web_accessible_resources: [
    {
      resources: ["repro.iife.js"],
      matches: ["<all_urls>"],
    },
  ],
})
