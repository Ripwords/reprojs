<script setup lang="ts">
import { computed, onMounted, ref } from "vue"

definePageMeta({ middleware: "admin-only" })

const toast = useToast()
const runtimeConfig = useRuntimeConfig()

// SDK embed origin falls back to the dashboard URL — that's where the SDK
// bundle is served from and where the intake API lives. Operators can swap
// this by pointing `BETTER_AUTH_URL` at their public dashboard hostname.
const SDK_ORIGIN = runtimeConfig.public.betterAuthUrl || "https://your-dashboard.example.com"
const PROJECT_KEY_EXAMPLE = "ft_pk_xxxxxxxxxxxxxxxxxxxxxxxx"

// Lazy-load shiki once. Cache the highlighter across tab switches so the
// ~1MB WASM payload only loads when the user actually opens this page.
let highlighterPromise: Promise<import("shiki").Highlighter> | null = null
function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: ["github-light", "github-dark"],
        langs: ["html", "javascript", "typescript", "bash"],
      }),
    )
  }
  return highlighterPromise
}

type SnippetLang = "html" | "javascript" | "typescript" | "bash"

interface Snippet {
  code: string
  lang: SnippetLang
  highlightedLight: string
  highlightedDark: string
}

async function highlight(
  code: string,
  lang: SnippetLang,
): Promise<Pick<Snippet, "highlightedLight" | "highlightedDark">> {
  const h = await getHighlighter()
  return {
    highlightedLight: h.codeToHtml(code, { lang, theme: "github-light" }),
    highlightedDark: h.codeToHtml(code, { lang, theme: "github-dark" }),
  }
}

// IMPORTANT: the backslash escapes on the closing script markers inside the
// HTML snippet below are mandatory. Without them the Vue SFC compiler sees
// a real closing tag and terminates this block early. Keep the backslashes
// even though oxlint flags them as "no-useless-escape".
/* oxlint-disable no-useless-escape */
const raw = {
  script: {
    lang: "html" as const,
    code: `<script src="${SDK_ORIGIN}/sdk/feedback-tool.iife.js" async><\/script>
<script>
  window.feedbackTool.init({
    projectKey: "${PROJECT_KEY_EXAMPLE}",
  })
<\/script>`,
  },
  npm: {
    lang: "bash" as const,
    code: "npm install @feedback-tool/core",
  },
  init: {
    lang: "typescript" as const,
    code: `import { init } from "@feedback-tool/core"

init({
  projectKey: "${PROJECT_KEY_EXAMPLE}",
  endpoint: "${SDK_ORIGIN}",
})`,
  },
  identify: {
    lang: "typescript" as const,
    code: `feedback.identify({
  userId: "user_123",
  email: "user@example.com",
  name: "Alex Example",
})`,
  },
} satisfies Record<string, { code: string; lang: SnippetLang }>
/* oxlint-enable no-useless-escape */

type SnippetKey = keyof typeof raw

const snippets = ref<Record<SnippetKey, Snippet>>({
  script: {
    code: raw.script.code,
    lang: raw.script.lang,
    highlightedLight: "",
    highlightedDark: "",
  },
  npm: {
    code: raw.npm.code,
    lang: raw.npm.lang,
    highlightedLight: "",
    highlightedDark: "",
  },
  init: {
    code: raw.init.code,
    lang: raw.init.lang,
    highlightedLight: "",
    highlightedDark: "",
  },
  identify: {
    code: raw.identify.code,
    lang: raw.identify.lang,
    highlightedLight: "",
    highlightedDark: "",
  },
})

onMounted(async () => {
  const keys = Object.keys(raw) as SnippetKey[]
  const results = await Promise.all(keys.map((key) => highlight(raw[key].code, raw[key].lang)))
  for (const [i, key] of keys.entries()) {
    const result = results[i]
    if (!result) continue
    snippets.value[key].highlightedLight = result.highlightedLight
    snippets.value[key].highlightedDark = result.highlightedDark
  }
})

async function copy(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    toast.add({
      title: "Copied to clipboard",
      color: "success",
      icon: "i-heroicons-clipboard-document-check",
    })
  } catch {
    toast.add({ title: "Copy failed", color: "error" })
  }
}

const accordionItems = computed(() => [
  { label: "1. Add the script tag", slot: "script" as const },
  { label: "2. Or install via npm", slot: "npm" as const },
  { label: "3. Initialize the SDK", slot: "init" as const },
  { label: "4. Identify signed-in users (optional)", slot: "identify" as const },
])
</script>

<template>
  <div class="space-y-6 max-w-4xl">
    <header>
      <h1 class="text-2xl font-semibold text-default">Install the SDK</h1>
      <p class="text-sm text-muted mt-1">
        Drop the widget into any web app in under a minute. Works with vanilla JS, React, Vue,
        Svelte, Nuxt, Next, or any framework.
      </p>
    </header>

    <UAccordion :items="accordionItems" multiple>
      <template #script-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Paste this before the closing
            <code class="font-mono px-1 rounded bg-muted">&lt;/body&gt;</code>
            tag. The widget loads asynchronously and won't block your page.
          </p>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="snippets.script.highlightedDark" />
            <div class="block dark:hidden" v-html="snippets.script.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(snippets.script.code)"
            />
          </div>
        </div>
      </template>
      <template #npm-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">Install the package:</p>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="snippets.npm.highlightedDark" />
            <div class="block dark:hidden" v-html="snippets.npm.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(snippets.npm.code)"
            />
          </div>
        </div>
      </template>
      <template #init-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Call <code class="font-mono px-1 rounded bg-muted">init()</code> once on app boot:
          </p>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="snippets.init.highlightedDark" />
            <div class="block dark:hidden" v-html="snippets.init.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(snippets.init.code)"
            />
          </div>
        </div>
      </template>
      <template #identify-body>
        <div class="space-y-2">
          <p class="text-sm text-muted">
            Call <code class="font-mono px-1 rounded bg-muted">identify()</code> after the user
            signs in so reports include their profile.
          </p>
          <div class="relative rounded-lg border border-default overflow-hidden">
            <div class="hidden dark:block" v-html="snippets.identify.highlightedDark" />
            <div class="block dark:hidden" v-html="snippets.identify.highlightedLight" />
            <UButton
              class="absolute top-2 right-2"
              icon="i-heroicons-clipboard"
              size="xs"
              color="neutral"
              variant="subtle"
              aria-label="Copy"
              @click="copy(snippets.identify.code)"
            />
          </div>
        </div>
      </template>
    </UAccordion>

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold text-default">Your project keys</h2>
      </template>
      <p class="text-sm text-muted">
        Replace
        <code class="font-mono px-1 rounded bg-muted">{{ PROJECT_KEY_EXAMPLE }}</code>
        in the snippets above with a real project's public key. Find it under
        <strong>Project &rarr; Settings &rarr; Security</strong>.
      </p>
    </UCard>
  </div>
</template>

<style>
/* Shiki-emitted <pre> styling — fit into our layout (no horizontal scroll
   jitter, consistent padding, monospace inherits from the page). */
.shiki {
  padding: 0.875rem 1rem;
  font-size: 0.875rem;
  line-height: 1.5;
  overflow-x: auto;
}
.shiki code {
  font-family: inherit;
}
</style>
