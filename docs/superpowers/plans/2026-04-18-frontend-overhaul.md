# Dashboard Frontend Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Per-page visual design:** Tasks 7-15 are per-page redesigns. When executing those tasks, the implementer should invoke `frontend-design:frontend-design` at the start of the task to get design-judgment support for the specific page (color tokens, spacing rhythm, micro-interactions). For foundation/shell/polish tasks (1-6, 16-18), the spec is detailed enough that direct implementation suffices.

**Goal:** Replace the dashboard's skeleton Tailwind styling with a professional, polished visual system built on Nuxt UI v3 + Tailwind 4 + Inter, shipping system-aware dark mode across every page.

**Architecture:** Single-release full sweep of `apps/dashboard/app/`. Nuxt UI v3 as the component library, Tailwind's official `@tailwindcss/vite` plugin kept (no `@nuxt/tailwindcss` module), `@nuxt/fonts` for self-hosted Inter + JetBrains Mono. New shell: project-scoped left sidebar + top bar, full-width pages, resizable `USlideover` report drawer. System-aware dark mode with manual toggle.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript strict, Tailwind v4, Nuxt UI v3, @nuxt/fonts, shiki (lazy), rrweb-player (existing), Heroicons + Simple Icons via Iconify, Bun for tooling.

**Reference spec:** `docs/superpowers/specs/2026-04-18-frontend-overhaul-design.md`

**Baseline:** tag `v0.7.1-session-replay`. Dashboard-only changes; SDK bundle and API contracts unchanged.

---

## File map

```
apps/dashboard/
├── package.json                                         MODIFY — add @nuxt/ui, @nuxt/fonts, @fontsource-variable/*, shiki
├── nuxt.config.ts                                       MODIFY — register modules, fonts config
├── app.config.ts                                        CREATE — Nuxt UI theme tokens (primary: indigo, neutral: slate)
├── app/
│   ├── assets/css/tailwind.css                          MODIFY — @theme block with semantic tokens
│   ├── layouts/
│   │   ├── default.vue                                  REWRITE — sidebar + top bar shell
│   │   └── auth.vue                                     REWRITE — centered card + gradient bg
│   ├── components/
│   │   ├── shell/
│   │   │   ├── app-sidebar.vue                          CREATE — collapsible project + admin nav
│   │   │   ├── app-top-bar.vue                          CREATE — project switcher + user menu + theme toggle
│   │   │   ├── project-switcher.vue                     CREATE — UCommandPalette for project selection
│   │   │   └── theme-toggle.vue                         CREATE — light/dark/system trio
│   │   ├── common/
│   │   │   ├── app-empty-state.vue                      CREATE — UEmptyState wrapper with gradient variant
│   │   │   ├── app-error-state.vue                      CREATE — soft red card + retry
│   │   │   ├── app-loading-skeleton.vue                 CREATE — reusable skeleton shapes
│   │   │   ├── confirm-delete-dialog.vue                CREATE — type-to-confirm destructive modal
│   │   │   └── keyboard-shortcuts-modal.vue             CREATE — cheat sheet opened via ?
│   │   ├── inbox/                                       REWRITE (existing 5 files)
│   │   ├── report-drawer/                               REWRITE (existing 9 files)
│   │   ├── integrations/                                REWRITE (existing 4 files)
│   │   └── ui/                                          CREATE (empty initially; shadcn-style customizations land here if needed)
│   ├── composables/
│   │   ├── useKeyboardShortcuts.ts                      CREATE — single-key + modifier handler
│   │   └── useApi.ts                                    UNCHANGED
│   └── pages/                                           REWRITE per-page bodies
│       ├── index.vue                                    Task 15
│       ├── auth/sign-in.vue                             Task 4
│       ├── projects/[id]/index.vue                      Task 9
│       ├── projects/[id]/reports.vue                    Task 7
│       ├── projects/[id]/members.vue                    Task 10
│       ├── projects/[id]/settings.vue                   Task 12
│       └── settings/
│           ├── users.vue                                Task 13
│           ├── install.vue                              Task 14
│           └── account.vue                              Task 13 (co-located with users)
```

**Conventions:**
- One commit per task. Commit messages conventional-commits (`feat(ui)`, `refactor(ui)`, `chore(ui)`).
- Each task ends with typecheck + lint verification; full `bun test` at task 18 only (the page-by-page sweep doesn't run the whole suite every time — only touched files need verification).
- Ban on `any`/`!` as always.

---

## Task 1: Foundation — install deps, wire modules, smoke test

**Files:**
- Modify: `apps/dashboard/package.json`
- Modify: `apps/dashboard/nuxt.config.ts`
- Create: `apps/dashboard/app.config.ts`

- [ ] **Step 1: Add deps to `apps/dashboard/package.json`**

Under `"dependencies"` add (or merge if already present):

```json
"@nuxt/ui": "^3.0.0",
"@nuxt/fonts": "^0.11.0",
"@fontsource-variable/inter": "^5.2.0",
"@fontsource-variable/jetbrains-mono": "^5.2.0",
"shiki": "^1.24.0",
```

Then install:
```bash
bun install
```

If `@nuxt/ui@^3.0.0` resolves to a pre-release that's too unstable, pin to the latest stable 3.x — report what was actually installed.

- [ ] **Step 2: Register modules in `apps/dashboard/nuxt.config.ts`**

Add `@nuxt/ui` and `@nuxt/fonts` to the `modules` array. The existing config lives at the top level of `nuxt.config.ts`. Insert (or create) a `modules` array:

```ts
  modules: ["@nuxt/ui", "@nuxt/fonts"],
```

Add a `fonts` block configuring self-hosted Inter + JetBrains Mono:

```ts
  fonts: {
    families: [
      { name: "Inter", provider: "fontsource", weights: ["400", "500", "600", "700"] },
      { name: "JetBrains Mono", provider: "fontsource", weights: ["400", "500"] },
    ],
  },
```

Keep all existing nuxt.config content (route rules, runtimeConfig, vite plugins, etc.) — only add the two blocks above.

- [ ] **Step 3: Create `apps/dashboard/app.config.ts`**

```ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: "indigo",
      neutral: "slate",
    },
    icons: {
      // Heroicons is Nuxt UI's default; keep it so no extra config needed.
    },
  },
})
```

- [ ] **Step 4: Smoke test dev server**

```bash
bun run dev
```

Wait for the server to report a URL (typically `http://localhost:3000`), then open it. Expected: the existing dashboard renders without errors. `@nuxt/ui` registers auto-imported components globally without breaking existing markup — existing pages should look identical.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/get-session
```
Expected: `200`.

- [ ] **Step 5: Typecheck + lint clean**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
bun run check
```
Expected: 0 errors from each (pre-existing warnings are OK).

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/bun.lock apps/dashboard/nuxt.config.ts apps/dashboard/app.config.ts bun.lock
git commit -m "feat(ui): install Nuxt UI v3 + @nuxt/fonts (Inter, JetBrains Mono)"
```

---

## Task 2: Typography + color tokens + dark mode wiring

**Files:**
- Modify: `apps/dashboard/app/assets/css/tailwind.css`

- [ ] **Step 1: Replace `apps/dashboard/app/assets/css/tailwind.css` with a `@theme` block that defines the font family, base sizes, and colors**

```css
@import "tailwindcss";
@import "@nuxt/ui";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* System-aware dark mode: Nuxt UI's useColorMode ships with the class-based
 * strategy by default. No extra config needed — `dark:` Tailwind variants
 * work against the root html.dark class that Nuxt UI manages. */

html {
  font-family: var(--font-sans);
}

code,
pre,
kbd,
samp {
  font-family: var(--font-mono);
}
```

- [ ] **Step 2: Restart dev server and verify Inter is loading**

Restart `bun run dev`. Open `http://localhost:3000/`. Open devtools Network tab, reload, confirm `.woff2` Inter file(s) load from `/_fonts/` (served by `@nuxt/fonts`). Body text should now render in Inter (slight "a" shape change — compare before/after).

- [ ] **Step 3: Typecheck + lint**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
bun run check
```
Both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/assets/css/tailwind.css
git commit -m "feat(ui): typography tokens (Inter + JetBrains Mono), Nuxt UI CSS import"
```

---

## Task 3: Sidebar component

**Files:**
- Create: `apps/dashboard/app/components/shell/app-sidebar.vue`

**Context:** The sidebar is project-scoped: when the route is `/projects/[id]/*`, it shows project nav items (Overview, Reports, Members, Integrations, Settings). When the route is `/settings/*` or `/`, it shows admin scope or nothing. Admin users get an additional "Admin" section with dividers. The sidebar collapses to a 56 px icon rail when `useCookie("sidebar-collapsed").value === true`.

- [ ] **Step 1: Create `apps/dashboard/app/components/shell/app-sidebar.vue`**

```vue
<script setup lang="ts">
import { computed } from "vue"
import { useRoute } from "vue-router"

const route = useRoute()
const { isAdmin } = useSession()
const collapsed = useCookie<boolean>("sidebar-collapsed", { default: () => false })

const projectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
})

interface NavItem {
  label: string
  icon: string
  to: string
  badge?: string | number
}

const projectItems = computed<NavItem[]>(() => {
  if (!projectId.value) return []
  const base = `/projects/${projectId.value}`
  return [
    { label: "Overview", icon: "i-heroicons-home", to: base },
    { label: "Reports", icon: "i-heroicons-inbox-stack", to: `${base}/reports` },
    { label: "Members", icon: "i-heroicons-user-group", to: `${base}/members` },
    { label: "Integrations", icon: "i-heroicons-squares-plus", to: `${base}/integrations` },
    { label: "Settings", icon: "i-heroicons-cog-6-tooth", to: `${base}/settings` },
  ]
})

const adminItems = computed<NavItem[]>(() => {
  if (!isAdmin.value) return []
  return [
    { label: "Users", icon: "i-heroicons-users", to: "/settings/users" },
    { label: "Install", icon: "i-heroicons-code-bracket", to: "/settings/install" },
  ]
})

const width = computed(() => (collapsed.value ? "w-14" : "w-60"))

function toggle() {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <aside
    :class="[
      width,
      'flex-shrink-0 border-r border-default bg-default flex flex-col transition-[width] duration-150',
    ]"
  >
    <div class="h-12 flex items-center px-3 border-b border-default">
      <UButton
        :icon="collapsed ? 'i-heroicons-bars-3' : 'i-heroicons-chevron-left'"
        color="neutral"
        variant="ghost"
        size="sm"
        :aria-label="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggle"
      />
    </div>
    <nav class="flex-1 overflow-y-auto py-2">
      <div v-if="projectItems.length > 0" class="space-y-0.5 px-2">
        <UButton
          v-for="item in projectItems"
          :key="item.to"
          :to="item.to"
          :icon="item.icon"
          :label="collapsed ? undefined : item.label"
          :active="route.path === item.to || route.path.startsWith(item.to + '/')"
          color="neutral"
          variant="ghost"
          size="sm"
          block
          :class="collapsed ? 'justify-center px-0' : 'justify-start'"
        >
          <template v-if="!collapsed && item.badge" #trailing>
            <UBadge :label="String(item.badge)" size="xs" variant="soft" />
          </template>
        </UButton>
      </div>
      <div v-if="adminItems.length > 0">
        <div v-if="!collapsed" class="mt-4 mb-1 px-3 text-xs font-medium uppercase text-muted">
          Admin
        </div>
        <USeparator v-else class="my-3" />
        <div class="space-y-0.5 px-2">
          <UButton
            v-for="item in adminItems"
            :key="item.to"
            :to="item.to"
            :icon="item.icon"
            :label="collapsed ? undefined : item.label"
            :active="route.path.startsWith(item.to)"
            color="neutral"
            variant="ghost"
            size="sm"
            block
            :class="collapsed ? 'justify-center px-0' : 'justify-start'"
          />
        </div>
      </div>
    </nav>
  </aside>
</template>
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
```
Expected: 0 errors. `useSession` must already return an `isAdmin` computed ref; if not, adapt `const isAdmin = computed(() => session.value?.user?.role === "admin")`.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app/components/shell/app-sidebar.vue
git commit -m "feat(ui): app-sidebar with project + admin scope + collapse"
```

---

## Task 4: Top bar + theme toggle + project switcher placeholder

**Files:**
- Create: `apps/dashboard/app/components/shell/app-top-bar.vue`
- Create: `apps/dashboard/app/components/shell/theme-toggle.vue`
- Create: `apps/dashboard/app/components/shell/project-switcher.vue`

- [ ] **Step 1: Create `apps/dashboard/app/components/shell/theme-toggle.vue`**

```vue
<script setup lang="ts">
const colorMode = useColorMode()

const items = [
  { label: "Light", icon: "i-heroicons-sun", value: "light" },
  { label: "Dark", icon: "i-heroicons-moon", value: "dark" },
  { label: "System", icon: "i-heroicons-computer-desktop", value: "system" },
] as const

function select(value: "light" | "dark" | "system") {
  colorMode.preference = value
}
</script>

<template>
  <UDropdownMenu :items="items.map((i) => ({ label: i.label, icon: i.icon, onSelect: () => select(i.value) }))">
    <UButton
      :icon="colorMode.value === 'dark' ? 'i-heroicons-moon' : 'i-heroicons-sun'"
      color="neutral"
      variant="ghost"
      size="sm"
      aria-label="Toggle theme"
    />
  </UDropdownMenu>
</template>
```

- [ ] **Step 2: Create `apps/dashboard/app/components/shell/project-switcher.vue`**

The switcher shows the current project name (or "Feedback Tool" outside a project) and opens a `UCommandPalette` listing all projects the user has access to. For v1 we don't wire `Cmd+K` globally — the switcher is only opened by clicking the top-bar trigger.

```vue
<script setup lang="ts">
import { computed, ref } from "vue"
import { useRoute, useRouter } from "vue-router"

interface ProjectSummary {
  id: string
  name: string
}

const route = useRoute()
const router = useRouter()
const open = ref(false)

const { data } = await useFetch<ProjectSummary[]>("/api/projects", { default: () => [] })

const currentProjectId = computed(() => {
  const m = /^\/projects\/([^/]+)/.exec(route.path)
  return m ? m[1] : null
})

const currentProject = computed(() =>
  data.value?.find((p) => p.id === currentProjectId.value) ?? null,
)

const items = computed(() =>
  (data.value ?? []).map((p) => ({
    label: p.name,
    onSelect: () => {
      router.push(`/projects/${p.id}`)
      open.value = false
    },
  })),
)
</script>

<template>
  <div>
    <UButton
      :label="currentProject?.name ?? 'Feedback Tool'"
      trailing-icon="i-heroicons-chevron-down"
      color="neutral"
      variant="ghost"
      size="sm"
      @click="open = true"
    />
    <UModal v-model:open="open" :ui="{ content: 'max-w-lg' }">
      <template #content>
        <UCommandPalette :groups="[{ id: 'projects', label: 'Projects', items }]" />
      </template>
    </UModal>
  </div>
</template>
```

- [ ] **Step 3: Create `apps/dashboard/app/components/shell/app-top-bar.vue`**

```vue
<script setup lang="ts">
import AppProjectSwitcher from "./project-switcher.vue"
import AppThemeToggle from "./theme-toggle.vue"

const { session, signOut } = useSession()

const email = computed(() => session.value?.user?.email ?? "")

const userItems = computed(() => [
  [
    {
      label: "Account",
      icon: "i-heroicons-user",
      to: "/settings/account",
    },
  ],
  [
    {
      label: "Sign out",
      icon: "i-heroicons-arrow-right-on-rectangle",
      onSelect: () => signOut(),
    },
  ],
])
</script>

<template>
  <header class="h-12 flex items-center justify-between px-4 border-b border-default bg-default">
    <AppProjectSwitcher />
    <div class="flex items-center gap-1">
      <UButton
        icon="i-heroicons-question-mark-circle"
        to="https://marker.io"
        target="_blank"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="Help"
      />
      <AppThemeToggle />
      <UDropdownMenu :items="userItems">
        <UButton color="neutral" variant="ghost" size="sm" :label="email" trailing-icon="i-heroicons-chevron-down" />
      </UDropdownMenu>
    </div>
  </header>
</template>
```

- [ ] **Step 4: Typecheck**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/app/components/shell
git commit -m "feat(ui): top bar with theme toggle + project switcher + user menu"
```

---

## Task 5: New `default.vue` layout wires the shell

**Files:**
- Modify: `apps/dashboard/app/layouts/default.vue`

- [ ] **Step 1: Replace `apps/dashboard/app/layouts/default.vue`**

```vue
<script setup lang="ts">
import AppSidebar from "~/components/shell/app-sidebar.vue"
import AppTopBar from "~/components/shell/app-top-bar.vue"
</script>

<template>
  <UApp>
    <div class="min-h-screen flex bg-muted text-default">
      <AppSidebar />
      <div class="flex-1 flex flex-col min-w-0">
        <AppTopBar />
        <main class="flex-1 overflow-y-auto">
          <div class="p-6">
            <slot />
          </div>
        </main>
      </div>
    </div>
  </UApp>
</template>
```

`UApp` is Nuxt UI's required root wrapper — it provides the toast host, modal host, and portal targets. Without it `useToast()` will throw.

- [ ] **Step 2: Smoke test — every page should render inside the new shell**

Restart `bun run dev`. Navigate to `/`, `/projects/<any-id>`, `/projects/<any-id>/reports`, `/settings/users`. Each page should render its current body content inside the new shell (sidebar shows for project routes, admin nav for admin users on settings routes). Page bodies still look old — that's expected, next tasks sweep them.

- [ ] **Step 3: Typecheck + lint**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
bun run check
```
Both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/app/layouts/default.vue
git commit -m "feat(ui): new default layout — sidebar + top bar shell"
```

---

## Task 6: Shared state components — empty / error / loading / confirm / shortcuts

**Files:**
- Create: `apps/dashboard/app/components/common/app-empty-state.vue`
- Create: `apps/dashboard/app/components/common/app-error-state.vue`
- Create: `apps/dashboard/app/components/common/app-loading-skeleton.vue`
- Create: `apps/dashboard/app/components/common/confirm-delete-dialog.vue`
- Create: `apps/dashboard/app/components/common/keyboard-shortcuts-modal.vue`
- Create: `apps/dashboard/app/composables/useKeyboardShortcuts.ts`

- [ ] **Step 1: Create `apps/dashboard/app/components/common/app-empty-state.vue`**

```vue
<script setup lang="ts">
interface Props {
  icon?: string
  title: string
  description?: string
  actionLabel?: string
  actionTo?: string
  variant?: "plain" | "gradient"
}

const props = withDefaults(defineProps<Props>(), {
  icon: "i-heroicons-inbox",
  variant: "plain",
})

defineEmits<{ action: [] }>()

const gradientClasses =
  "relative overflow-hidden rounded-xl border border-default bg-gradient-to-br from-primary-50 via-default to-default dark:from-primary-950/30 dark:via-default dark:to-default"
</script>

<template>
  <div
    :class="[
      variant === 'gradient' ? gradientClasses : 'rounded-xl border border-default bg-default',
      'flex flex-col items-center justify-center text-center px-6 py-16',
    ]"
  >
    <UIcon :name="props.icon" class="size-12 text-muted mb-4" />
    <h3 class="text-lg font-semibold text-default">{{ title }}</h3>
    <p v-if="description" class="mt-2 text-sm text-muted max-w-md">{{ description }}</p>
    <div v-if="actionLabel" class="mt-6">
      <UButton
        :label="actionLabel"
        :to="actionTo"
        color="primary"
        @click="!actionTo && $emit('action')"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `apps/dashboard/app/components/common/app-error-state.vue`**

```vue
<script setup lang="ts">
interface Props {
  title?: string
  message: string
  detail?: string
}

withDefaults(defineProps<Props>(), {
  title: "Something went wrong",
})

defineEmits<{ retry: [] }>()
</script>

<template>
  <div
    class="rounded-xl border border-error/30 bg-error/5 px-6 py-10 flex flex-col items-center text-center"
  >
    <UIcon name="i-heroicons-exclamation-triangle" class="size-10 text-error mb-3" />
    <h3 class="text-base font-semibold text-default">{{ title }}</h3>
    <p class="mt-2 text-sm text-muted max-w-md">{{ message }}</p>
    <div class="mt-5 flex gap-2">
      <UButton label="Retry" color="neutral" variant="outline" @click="$emit('retry')" />
      <UButton
        v-if="detail"
        label="Copy error"
        color="neutral"
        variant="ghost"
        @click="navigator.clipboard?.writeText(detail)"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Create `apps/dashboard/app/components/common/app-loading-skeleton.vue`**

```vue
<script setup lang="ts">
interface Props {
  variant: "table" | "card" | "form"
  rows?: number
}

withDefaults(defineProps<Props>(), { rows: 6 })
</script>

<template>
  <div v-if="variant === 'table'" class="space-y-2">
    <USkeleton class="h-9 w-full" />
    <USkeleton v-for="n in rows" :key="n" class="h-9 w-full" />
  </div>
  <div v-else-if="variant === 'card'" class="rounded-xl border border-default bg-default p-6 space-y-3">
    <USkeleton class="h-5 w-1/3" />
    <USkeleton class="h-4 w-2/3" />
    <USkeleton class="h-4 w-1/2" />
  </div>
  <div v-else class="space-y-4">
    <div v-for="n in rows" :key="n" class="space-y-2">
      <USkeleton class="h-4 w-24" />
      <USkeleton class="h-9 w-full" />
    </div>
  </div>
</template>
```

- [ ] **Step 4: Create `apps/dashboard/app/components/common/confirm-delete-dialog.vue`**

```vue
<script setup lang="ts">
import { ref, computed } from "vue"

interface Props {
  open: boolean
  title: string
  description: string
  /** If set, user must type this exact string before confirm is enabled. */
  confirmText?: string
  loading?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{ "update:open": [boolean]; confirm: [] }>()

const typed = ref("")
const canConfirm = computed(() => {
  if (!props.confirmText) return true
  return typed.value === props.confirmText
})

function close() {
  typed.value = ""
  emit("update:open", false)
}
</script>

<template>
  <UModal :open="open" @update:open="close">
    <template #content>
      <div class="p-6 space-y-4">
        <h3 class="text-lg font-semibold text-default">{{ title }}</h3>
        <p class="text-sm text-muted">{{ description }}</p>
        <div v-if="confirmText" class="space-y-2">
          <p class="text-sm text-muted">
            Type <code class="px-1 rounded bg-muted">{{ confirmText }}</code> to confirm.
          </p>
          <UInput v-model="typed" :placeholder="confirmText" />
        </div>
        <div class="flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="close" />
          <UButton
            label="Delete"
            color="error"
            :disabled="!canConfirm"
            :loading="loading"
            @click="emit('confirm')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 5: Create `apps/dashboard/app/composables/useKeyboardShortcuts.ts`**

```ts
import { onMounted, onBeforeUnmount } from "vue"

export interface ShortcutMap {
  [key: string]: (event: KeyboardEvent) => void
}

/**
 * Registers document-level keyboard shortcuts. Keys are lowercase single chars
 * or the special values `"escape"`, `"enter"`. Shortcuts are suppressed when
 * the event target is an editable element (input, textarea, contenteditable).
 */
export function useKeyboardShortcuts(map: ShortcutMap): void {
  function handler(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null
    if (target) {
      const tag = target.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (target.isContentEditable) return
    }
    const key = event.key.toLowerCase()
    const fn = map[key]
    if (!fn) return
    fn(event)
  }

  onMounted(() => document.addEventListener("keydown", handler))
  onBeforeUnmount(() => document.removeEventListener("keydown", handler))
}
```

- [ ] **Step 6: Create `apps/dashboard/app/components/common/keyboard-shortcuts-modal.vue`**

```vue
<script setup lang="ts">
interface Shortcut {
  keys: string[]
  label: string
}

interface Props {
  open: boolean
  shortcuts: Shortcut[]
}

defineProps<Props>()
defineEmits<{ "update:open": [boolean] }>()
</script>

<template>
  <UModal :open="open" @update:open="(v) => $emit('update:open', v)" :ui="{ content: 'max-w-md' }">
    <template #content>
      <div class="p-6">
        <h3 class="text-lg font-semibold text-default mb-4">Keyboard shortcuts</h3>
        <ul class="space-y-2">
          <li
            v-for="s in shortcuts"
            :key="s.label"
            class="flex items-center justify-between text-sm"
          >
            <span class="text-muted">{{ s.label }}</span>
            <span class="flex gap-1">
              <UKbd v-for="k in s.keys" :key="k">{{ k }}</UKbd>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 7: Typecheck**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add apps/dashboard/app/components/common apps/dashboard/app/composables/useKeyboardShortcuts.ts
git commit -m "feat(ui): shared state components — empty, error, loading, confirm, shortcuts"
```

---

## Task 7: Inbox page — reports list

**Before starting this task, invoke `frontend-design:frontend-design` with the question "refine the inbox table layout and row density based on Linear's triage list pattern". Use its output to adjust spacing, column widths, and visual emphasis before implementing.**

**Files:**
- Rewrite: `apps/dashboard/app/pages/projects/[id]/reports.vue`
- Rewrite: `apps/dashboard/app/components/inbox/report-row.vue`
- Rewrite: `apps/dashboard/app/components/inbox/search-sort.vue`
- Rewrite: `apps/dashboard/app/components/inbox/status-tabs.vue`
- Rewrite: `apps/dashboard/app/components/inbox/facet-sidebar.vue`
- Rewrite: `apps/dashboard/app/components/inbox/bulk-action-bar.vue`

**Note**: the inbox is large enough that a single task with every file's full content would bloat this plan. Each file rewrite is a judgment call guided by the spec §3 inbox description. The engineer should read each existing file first, preserve the data-fetching/state logic intact, and replace only the template + scoped styles + inline class sets. Below are the structural requirements that MUST be met; exact markup is up to the engineer (with frontend-design skill's help).

- [ ] **Step 1: Read all 6 files to understand the existing data flow**

```bash
wc -l apps/dashboard/app/pages/projects/[id]/reports.vue apps/dashboard/app/components/inbox/*.vue
cat apps/dashboard/app/pages/projects/[id]/reports.vue
```

Map:
- The page owns the data fetch + filter/sort state
- `status-tabs.vue` renders `open/in_progress/resolved/closed` tabs with counts
- `facet-sidebar.vue` renders priority + tag facets
- `search-sort.vue` renders search input + sort dropdown
- `report-row.vue` renders a single row
- `bulk-action-bar.vue` replaces search-sort when rows are selected

The rewrite preserves all of these responsibilities.

- [ ] **Step 2: Rewrite the page shell — 3-pane layout**

In `pages/projects/[id]/reports.vue`, change the outer wrapper to:

```vue
<div class="flex gap-6 h-[calc(100vh-theme(spacing.24))]">
  <FacetSidebar ... class="w-60 flex-shrink-0" />
  <div class="flex-1 min-w-0 flex flex-col">
    <div class="mb-4">
      <BulkActionBar v-if="selectedIds.length > 0" ... />
      <SearchSort v-else ... />
    </div>
    <StatusTabs ... class="mb-3" />
    <div class="flex-1 min-h-0 overflow-y-auto">
      <UTable ...rows... />
    </div>
  </div>
  <ReportDrawer v-if="openReport" ... />
</div>
```

Row click opens the drawer; the background table keeps selection. Details in the next steps.

- [ ] **Step 3: Rewrite the table as `UTable`**

```vue
<UTable
  :data="reports"
  :columns="columns"
  :loading="pending"
  v-model:row-selection="rowSelection"
  :ui="{ th: 'text-xs font-medium text-muted', td: 'text-sm' }"
  @select="onRowClick"
/>
```

`columns` definition (TypeScript, in the `<script setup>`):

```ts
import type { TableColumn } from "@nuxt/ui"
import type { ReportSummaryDTO } from "@feedback-tool/shared"

const columns: TableColumn<ReportSummaryDTO>[] = [
  {
    id: "select",
    header: ({ table }) => h(UCheckbox, {
      modelValue: table.getIsAllPageRowsSelected(),
      "onUpdate:modelValue": (v: boolean) => table.toggleAllPageRowsSelected(!!v),
    }),
    cell: ({ row }) => h(UCheckbox, {
      modelValue: row.getIsSelected(),
      "onUpdate:modelValue": (v: boolean) => row.toggleSelected(!!v),
    }),
  },
  {
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => h("div", { class: "font-medium text-default truncate" }, row.original.title),
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => h(UBadge, {
      label: row.original.priority,
      color: priorityColor(row.original.priority),
      variant: "soft",
      size: "xs",
    }),
  },
  {
    accessorKey: "assignee",
    header: "Assignee",
    cell: ({ row }) => row.original.assignee?.name ?? row.original.assignee?.email ?? "—",
  },
  {
    accessorKey: "reporterEmail",
    header: "Reporter",
    cell: ({ row }) => row.original.reporterEmail ?? "—",
  },
  {
    accessorKey: "receivedAt",
    header: "",
    cell: ({ row }) => h(UTooltip, { text: new Date(row.original.receivedAt).toLocaleString() }, () =>
      relativeTime(row.original.receivedAt),
    ),
  },
]

function priorityColor(p: string): "error" | "warning" | "neutral" | "primary" {
  if (p === "urgent") return "error"
  if (p === "high") return "warning"
  if (p === "normal") return "primary"
  return "neutral"
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diffMs / 3_600_000)
  if (h < 1) return "just now"
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}
```

- [ ] **Step 4: Keyboard navigation**

```ts
import { useKeyboardShortcuts } from "~/composables/useKeyboardShortcuts"

useKeyboardShortcuts({
  j: () => moveSelection(1),
  k: () => moveSelection(-1),
  enter: () => openCurrent(),
  escape: () => closeDrawer(),
})

function moveSelection(delta: number) {
  // implement: update `highlightedIndex` ref, scroll into view
}
function openCurrent() {
  // open drawer for row at highlightedIndex
}
function closeDrawer() {
  openReport.value = null
}
```

- [ ] **Step 5: Empty state wiring**

```vue
<AppEmptyState
  v-if="!pending && reports.length === 0"
  :icon="filters.search || filters.status ? 'i-heroicons-funnel' : 'i-heroicons-inbox'"
  :title="filters.search || filters.status ? 'No reports match these filters' : 'No reports yet'"
  :description="filters.search || filters.status ? 'Try clearing the search or adjusting the status filter.' : 'Reports will appear here when the SDK is installed and users submit bugs.'"
  :action-label="filters.search || filters.status ? 'Clear filters' : 'View install instructions'"
  :action-to="filters.search || filters.status ? undefined : '/settings/install'"
  :variant="reports.length === 0 && !filters.search ? 'gradient' : 'plain'"
  @action="clearFilters"
/>
```

- [ ] **Step 6: Facet sidebar + status tabs + search-sort + bulk-action bar rewrites**

Each is a direct port to Nuxt UI: `UButton variant="ghost"` for facets (with `UBadge` right-aligned for counts), `UTabs` for the status switcher, `UInput` + `USelectMenu` for search-sort, `UButton.Group` for bulk actions. Preserve all existing data bindings; only change the markup and Tailwind classes.

- [ ] **Step 7: Typecheck**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 8: Smoke test**

Dev server running, navigate to `/projects/<id>/reports`. Verify: rows render; row click opens old drawer (still working, new drawer comes in Task 8); `j/k/Enter/Esc` work; bulk checkbox selects rows and shows bulk bar; filter facets count correctly; search debounces.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/app/pages/projects/\[id\]/reports.vue apps/dashboard/app/components/inbox
git commit -m "refactor(ui): rewrite inbox page with UTable + full-width 3-pane layout"
```

---

## Task 8: Report drawer — USlideover + resize + triage footer

**Before starting this task, invoke `frontend-design:frontend-design` with the question "layout a dense report drawer with 8 tabs, always-visible triage footer, resizable edge handle". Use its output for tab label styling, footer density, and edge-handle affordance.**

**Files:**
- Rewrite: `apps/dashboard/app/components/report-drawer/drawer.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/tabs.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/overview-tab.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/console-tab.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/network-tab.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/activity-tab.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/cookies-tab.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/replay-tab.vue`
- Rewrite: `apps/dashboard/app/components/report-drawer/triage-panel.vue` → becomes `triage-footer.vue`

- [ ] **Step 1: Convert `drawer.vue` to a `USlideover` with resizable edge**

```vue
<script setup lang="ts">
import { computed, ref } from "vue"
import type { ReportSummaryDTO } from "@feedback-tool/shared"
import TriageFooter from "./triage-footer.vue"
import DrawerTabs from "./tabs.vue"

interface Props {
  open: boolean
  projectId: string
  report: ReportSummaryDTO
}

const props = defineProps<Props>()
const emit = defineEmits<{ "update:open": [boolean]; updated: [] }>()

const drawerWidth = useCookie<number>("drawer-width", { default: () => 470 })

const activeTab = ref<string>("overview")
const tabs = computed(() => [
  { id: "overview", label: "Overview" },
  { id: "console", label: "Console" },
  { id: "network", label: "Network" },
  { id: "replay", label: "Replay" },
  { id: "activity", label: "Activity" },
  { id: "cookies", label: "Cookies" },
  { id: "system", label: "System" },
  { id: "raw", label: "Raw" },
])

// Resize handle: drag left edge.
const resizing = ref(false)
function startResize(e: MouseEvent) {
  e.preventDefault()
  resizing.value = true
  const startX = e.clientX
  const startW = drawerWidth.value

  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX
    const next = Math.max(400, Math.min(800, startW + delta))
    drawerWidth.value = next
  }
  function onUp() {
    resizing.value = false
    document.removeEventListener("mousemove", onMove)
    document.removeEventListener("mouseup", onUp)
  }
  document.addEventListener("mousemove", onMove)
  document.addEventListener("mouseup", onUp)
}
</script>

<template>
  <USlideover
    :open="open"
    @update:open="(v) => emit('update:open', v)"
    side="right"
    :ui="{ content: 'shadow-xl' }"
  >
    <template #content>
      <div
        class="h-full flex flex-col bg-default relative"
        :style="{ width: drawerWidth + 'px' }"
      >
        <!-- Resize handle -->
        <div
          class="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-primary-500/30"
          :class="{ 'bg-primary-500/50': resizing }"
          @mousedown="startResize"
          aria-label="Resize drawer"
          role="separator"
        />
        <!-- Header -->
        <div class="flex items-center justify-between px-5 h-14 border-b border-default">
          <UButton
            icon="i-heroicons-x-mark"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Close"
            @click="emit('update:open', false)"
          />
          <UDropdownMenu :items="actionMenuItems">
            <UButton trailing-icon="i-heroicons-ellipsis-vertical" variant="ghost" color="neutral" size="sm" />
          </UDropdownMenu>
        </div>
        <!-- Title block -->
        <div class="px-5 py-4 border-b border-default">
          <div class="flex items-start justify-between gap-4">
            <h2 class="text-lg font-semibold text-default truncate">{{ report.title }}</h2>
            <UBadge
              :label="report.priority"
              :color="priorityColor(report.priority)"
              variant="soft"
              size="xs"
            />
          </div>
          <div class="mt-1 text-xs text-muted truncate">
            {{ report.context.pageUrl }} · {{ relativeTime(report.receivedAt) }}
          </div>
        </div>
        <!-- Tabs -->
        <DrawerTabs v-model="activeTab" :tabs="tabs" class="border-b border-default" />
        <!-- Tab content -->
        <div class="flex-1 min-h-0 overflow-y-auto">
          <OverviewTab v-if="activeTab === 'overview'" :report="report" />
          <ConsoleTab v-else-if="activeTab === 'console'" :project-id="projectId" :report-id="report.id" />
          <NetworkTab v-else-if="activeTab === 'network'" :project-id="projectId" :report-id="report.id" />
          <ReplayTab
            v-else-if="activeTab === 'replay'"
            :key="report.id"
            :project-id="projectId"
            :report-id="report.id"
            :has-replay="report.hasReplay"
          />
          <ActivityTab v-else-if="activeTab === 'activity'" :project-id="projectId" :report-id="report.id" />
          <CookiesTab v-else-if="activeTab === 'cookies'" :report="report" />
          <div v-else-if="activeTab === 'system'" class="p-5">
            <pre class="text-xs">{{ JSON.stringify(report.context.systemInfo, null, 2) }}</pre>
          </div>
          <div v-else-if="activeTab === 'raw'" class="p-5">
            <pre class="text-xs">{{ JSON.stringify(report, null, 2) }}</pre>
          </div>
        </div>
        <!-- Triage footer (always visible) -->
        <TriageFooter :project-id="projectId" :report="report" @updated="emit('updated')" />
      </div>
    </template>
  </USlideover>
</template>
```

- [ ] **Step 2: Rewrite `tabs.vue` with scroll-overflow**

```vue
<script setup lang="ts">
interface Tab {
  id: string
  label: string
  hasData?: boolean
}

interface Props {
  modelValue: string
  tabs: Tab[]
}

const props = defineProps<Props>()
const emit = defineEmits<{ "update:modelValue": [string] }>()
</script>

<template>
  <nav class="flex overflow-x-auto scrollbar-thin">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      :class="[
        'px-4 h-11 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
        modelValue === tab.id
          ? 'border-primary text-default'
          : 'border-transparent text-muted hover:text-default',
      ]"
      @click="emit('update:modelValue', tab.id)"
    >
      {{ tab.label }}
      <span
        v-if="tab.hasData"
        class="inline-block ml-1.5 w-1.5 h-1.5 rounded-full bg-primary-500"
      />
    </button>
  </nav>
</template>
```

- [ ] **Step 3: Extract triage into a footer component**

Rename `triage-panel.vue` → `triage-footer.vue`. Restructure layout to sit at the drawer bottom as a horizontal row of controls:

```vue
<template>
  <div class="border-t border-default px-5 py-3 flex flex-wrap items-center gap-3 bg-muted/30">
    <USelectMenu v-model="status" :items="statusOptions" size="sm" class="w-28" />
    <USelectMenu v-model="assigneeId" :items="assigneeOptions" size="sm" class="w-36" />
    <USelectMenu v-model="priority" :items="priorityOptions" size="sm" class="w-28" />
    <div class="flex-1 min-w-0 flex flex-wrap gap-1 items-center">
      <UBadge
        v-for="t in tags"
        :key="t"
        :label="t"
        size="xs"
        variant="soft"
        color="neutral"
        class="cursor-pointer"
        @click="removeTag(t)"
      >
        <template #trailing>
          <UIcon name="i-heroicons-x-mark" class="size-3" />
        </template>
      </UBadge>
      <UInput
        v-model="newTag"
        placeholder="+ tag"
        size="xs"
        class="w-20"
        @keydown.enter="addTag"
      />
    </div>
  </div>
</template>
```

Preserve all existing mutation logic (the PATCH calls to the triage endpoint). Only the layout + component swap changes.

- [ ] **Step 4: Each tab component — restyle only**

For each of `overview-tab.vue`, `console-tab.vue`, `network-tab.vue`, `activity-tab.vue`, `cookies-tab.vue`, `replay-tab.vue`: read existing file, keep data-fetching + state, replace markup with Nuxt UI primitives (`UCard`, `UTable` for tabular tab content, `UAccordion` for stack traces, etc.). The `replay-tab.vue` lazy rrweb-player logic stays — only wrap the outer container in `UCard`.

- [ ] **Step 5: Typecheck**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 6: Smoke test**

Open inbox, click a report, verify:
- Drawer slides in from right
- Resize handle on left edge drags smoothly, width persists on refresh
- All 8 tabs switch content
- Triage footer shows at bottom with working controls
- `Esc` closes drawer
- Replay tab still plays

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/app/components/report-drawer
git commit -m "refactor(ui): report drawer — USlideover, resizable, triage footer, tabs rebuilt"
```

---

## Task 9: Project overview page

**Before starting this task, invoke `frontend-design:frontend-design` with the question "design metric tiles + recent activity feed for a project overview page, balancing information density with breathing room".**

**Files:**
- Rewrite: `apps/dashboard/app/pages/projects/[id]/index.vue`

- [ ] **Step 1: Page layout — header + metric tiles + recent reports + activity**

```vue
<template>
  <div class="space-y-6">
    <!-- Page header -->
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-default">{{ project?.name ?? "..." }}</h1>
        <p class="text-sm text-muted mt-1">Project overview</p>
      </div>
      <UButton to="/projects/{{ project?.id }}/reports" label="Go to inbox" trailing-icon="i-heroicons-arrow-right" />
    </header>

    <!-- Metric tiles -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <UCard>
        <div class="text-sm text-muted">Open reports</div>
        <div class="mt-1 text-3xl font-semibold text-default">{{ metrics.open }}</div>
        <div class="mt-1 text-xs text-muted">{{ metrics.openDelta > 0 ? `+${metrics.openDelta}` : metrics.openDelta }} vs last week</div>
      </UCard>
      <UCard>
        <div class="text-sm text-muted">Resolved this week</div>
        <div class="mt-1 text-3xl font-semibold text-default">{{ metrics.resolvedThisWeek }}</div>
      </UCard>
      <UCard>
        <div class="text-sm text-muted">Median time to triage</div>
        <div class="mt-1 text-3xl font-semibold text-default">{{ metrics.medianTriageHours }}h</div>
      </UCard>
      <UCard>
        <div class="text-sm text-muted">GitHub sync</div>
        <div class="mt-1 flex items-center gap-2">
          <UBadge :label="integration.status" :color="integration.status === 'connected' ? 'success' : 'neutral'" variant="soft" size="xs" />
          <span v-if="integration.repoName" class="text-sm text-muted truncate">{{ integration.repoOwner }}/{{ integration.repoName }}</span>
        </div>
      </UCard>
    </div>

    <!-- Two-column: recent reports + recent activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Recent reports</h2>
        </template>
        <div v-if="recentReports.length === 0" class="text-sm text-muted py-8 text-center">No reports yet.</div>
        <ul v-else class="space-y-2">
          <li v-for="r in recentReports" :key="r.id" class="flex items-center gap-3 text-sm">
            <UBadge :label="r.priority" :color="priorityColor(r.priority)" variant="soft" size="xs" />
            <NuxtLink :to="`/projects/${project.id}/reports?open=${r.id}`" class="flex-1 min-w-0 truncate text-default hover:text-primary">
              {{ r.title }}
            </NuxtLink>
            <span class="text-xs text-muted whitespace-nowrap">{{ relativeTime(r.receivedAt) }}</span>
          </li>
        </ul>
      </UCard>
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold text-default">Activity</h2>
        </template>
        <ul class="space-y-2">
          <li v-for="e in recentActivity" :key="e.id" class="text-sm text-muted">
            <span class="text-default">{{ e.actor?.name ?? e.actor?.email ?? "System" }}</span>
            {{ e.description }}
            <span class="text-xs">{{ relativeTime(e.createdAt) }}</span>
          </li>
        </ul>
      </UCard>
    </div>

    <!-- Activation CTA for fresh projects -->
    <AppEmptyState
      v-if="recentReports.length === 0"
      variant="gradient"
      icon="i-heroicons-code-bracket"
      title="Install the SDK to start receiving reports"
      description="Add a single <script> tag to your site or npm-install @feedback-tool/core."
      action-label="View install instructions"
      action-to="/settings/install"
    />
  </div>
</template>
```

- [ ] **Step 2: Preserve existing data fetches**

The existing `<script setup>` has `useFetch` calls for `/api/projects/[id]/overview` (metrics), `/api/projects/[id]/reports?limit=5` (recents), `/api/projects/[id]/reports/[id]/events?limit=10` (activity). Keep them.

- [ ] **Step 3: Typecheck**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
```

- [ ] **Step 4: Smoke test + commit**

Navigate to `/projects/<id>`, verify tiles render, recent reports + activity populate.

```bash
git add apps/dashboard/app/pages/projects/\[id\]/index.vue
git commit -m "refactor(ui): project overview — metric tiles + recent reports + activity"
```

---

## Task 10: Members page

**Before starting this task, invoke `frontend-design:frontend-design` with "refine a members management page: table of members + invite modal, role column with inline select, last-active relative time".**

**Files:**
- Rewrite: `apps/dashboard/app/pages/projects/[id]/members.vue`

- [ ] **Step 1: Convert to `UTable` + `UModal` invite form**

Structure:
- Page header: "Members" title + "Invite member" button
- `UTable` of members: Avatar + name, email, role (inline `USelectMenu`), joined date, actions (`UDropdownMenu` → Remove)
- `UModal` triggered by "Invite member" button with email + role form
- Empty state if only the owner exists

Preserve the existing data fetching + PATCH/DELETE endpoints; only markup changes.

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
git add apps/dashboard/app/pages/projects/\[id\]/members.vue
git commit -m "refactor(ui): members page — UTable + UModal invite"
```

---

## Task 11: Integrations page

**Before starting this task, invoke `frontend-design:frontend-design` with "design a card-per-integration page with a prominent GitHub panel, status pill, connect/disconnect CTA".**

**Files:**
- Rewrite: `apps/dashboard/app/components/integrations/github/github-panel.vue`
- Rewrite: `apps/dashboard/app/components/integrations/github/repo-picker.vue`
- Rewrite: `apps/dashboard/app/components/integrations/github/sync-status.vue`
- Rewrite: `apps/dashboard/app/components/integrations/github/unlink-dialog.vue`
- Create: `apps/dashboard/app/pages/projects/[id]/integrations.vue` (if doesn't exist — add as new route)

- [ ] **Step 1: If `integrations.vue` doesn't exist, create it**

```bash
ls apps/dashboard/app/pages/projects/\[id\]/ | grep integrations
```

If missing, add a new `integrations.vue` that renders the integrations cards. Otherwise just rewrite the existing page.

- [ ] **Step 2: Rewrite each integration component to Nuxt UI primitives**

`github-panel.vue`: `UCard` with Simple Icons `i-simple-icons-github` icon, status pill (`UBadge`), installation info, repo picker, "Disconnect" button opens `ConfirmDeleteDialog`.

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
git add apps/dashboard/app/pages/projects apps/dashboard/app/components/integrations
git commit -m "refactor(ui): integrations page + GitHub panel with UCard + UBadge + confirm dialog"
```

---

## Task 12: Project settings page

**Before starting this task, invoke `frontend-design:frontend-design` with "design tab-sectioned form page — general, triage, security, data retention — with good hierarchy and form field density".**

**Files:**
- Rewrite: `apps/dashboard/app/pages/projects/[id]/settings.vue`

- [ ] **Step 1: Restructure as `UTabs` with sectioned forms**

Sections:
- **General**: name, description, allowed origins (chip input), daily cap
- **Triage**: default labels, default assignee, replay enabled toggle
- **Security**: public key display with rotate button (existing flow), allowed email domains
- **Danger zone**: delete project (red card at bottom with `ConfirmDeleteDialog`)

Use `UForm` + `UFormField` + `UInput` + `USwitch` + `UTextarea` throughout.

Preserve all existing PATCH + validation logic.

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
git add apps/dashboard/app/pages/projects/\[id\]/settings.vue
git commit -m "refactor(ui): project settings — UTabs sectioned form"
```

---

## Task 13: Install-level users + account

**Before starting this task, invoke `frontend-design:frontend-design` with "design install-level users admin page (invite, list, role edit, disable) with the same visual language as the project-scoped members page".**

**Files:**
- Rewrite: `apps/dashboard/app/pages/settings/users.vue`
- Rewrite: `apps/dashboard/app/pages/settings/account.vue`

- [ ] **Step 1: `users.vue` — same pattern as members.vue but with install-level actions**

Invite form, `UTable` listing, role edit, disable button with confirm modal.

- [ ] **Step 2: `account.vue` — profile form + sessions panel + sign out all**

Name/email form (`UForm`), `UCard` for active sessions list, `UButton color="error" variant="soft"` for "Sign out all other sessions".

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
git add apps/dashboard/app/pages/settings
git commit -m "refactor(ui): install users + account pages"
```

---

## Task 14: Install instructions page

**Before starting this task, invoke `frontend-design:frontend-design` with "design a developer-facing install instructions page with copy-able code blocks (shiki syntax highlighting), step-by-step accordion, and inline snippets".**

**Files:**
- Rewrite: `apps/dashboard/app/pages/settings/install.vue`

- [ ] **Step 1: Install shiki highlighter helper**

Lazy-import `shiki` inside the component:

```ts
let highlighter: import("shiki").Highlighter | null = null
async function getHighlighter() {
  if (highlighter) return highlighter
  const { createHighlighter } = await import("shiki")
  highlighter = await createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: ["html", "javascript", "typescript", "bash"],
  })
  return highlighter
}
```

- [ ] **Step 2: Rewrite page as `UAccordion` of steps**

Each step has: heading, prose description, code block rendered with shiki, "Copy" button.

```vue
<UAccordion :items="steps">
  <template #body="{ item }">
    <div v-html="item.highlightedCode" class="text-sm" />
    <UButton label="Copy" size="xs" variant="ghost" @click="copy(item.rawCode)" />
  </template>
</UAccordion>
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
git add apps/dashboard/app/pages/settings/install.vue
git commit -m "refactor(ui): install page — accordion + shiki syntax highlighting"
```

---

## Task 15: Projects index + sign-in

**Before starting this task, invoke `frontend-design:frontend-design` with "design a welcoming sign-in card with magic-link + OAuth buttons on a subtle gradient, and a projects grid with one create-project card".**

**Files:**
- Rewrite: `apps/dashboard/app/pages/index.vue`
- Rewrite: `apps/dashboard/app/pages/auth/sign-in.vue`
- Rewrite: `apps/dashboard/app/layouts/auth.vue`

- [ ] **Step 1: `auth.vue` layout with gradient bg**

```vue
<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 via-default to-default dark:from-primary-950/30 dark:via-default dark:to-default">
    <div class="w-full max-w-md px-6">
      <slot />
    </div>
  </div>
</template>
```

- [ ] **Step 2: `sign-in.vue` with magic link + OAuth**

Card with the three entry points (magic link form, GitHub button, Google button). Reuse the existing sign-in logic (magic link send, OAuth initiation). Match visual layout of the reference sites' sign-in pages (Linear/Marker-style card on gradient).

- [ ] **Step 3: Projects index — grid of project cards + "New project" tile**

```vue
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  <UCard v-for="p in projects" :key="p.id" :to="`/projects/${p.id}`" class="hover:border-primary transition-colors">
    <h3 class="text-base font-semibold text-default">{{ p.name }}</h3>
    <p class="mt-1 text-sm text-muted">{{ p.openCount ?? 0 }} open reports</p>
  </UCard>
  <button
    v-if="canCreate"
    type="button"
    class="rounded-xl border-2 border-dashed border-default hover:border-primary p-6 flex flex-col items-center justify-center text-muted hover:text-primary transition-colors"
    @click="newProjectOpen = true"
  >
    <UIcon name="i-heroicons-plus" class="size-8" />
    <span class="mt-2 text-sm font-medium">New project</span>
  </button>
</div>
```

Empty state (no projects yet): gradient variant `AppEmptyState` with prominent "Create your first project" CTA.

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
git add apps/dashboard/app/pages/index.vue apps/dashboard/app/pages/auth/sign-in.vue apps/dashboard/app/layouts/auth.vue
git commit -m "refactor(ui): projects index + sign-in with gradient auth layout"
```

---

## Task 16: Toasts across every mutation

**Files:**
- Touch every `.vue` file that has a mutation handler (PATCH/POST/DELETE)

- [ ] **Step 1: Inventory mutation handlers**

```bash
grep -rn 'method:\s*"(POST|PATCH|DELETE|PUT)"' apps/dashboard/app --include="*.vue" | head -40
```

- [ ] **Step 2: Wire `useToast()` in each handler**

Pattern:

```ts
const toast = useToast()

async function save() {
  try {
    await $fetch("/api/...", { method: "PATCH", body: { ... } })
    toast.add({ title: "Saved", color: "success", icon: "i-heroicons-check-circle" })
  } catch (err) {
    toast.add({
      title: "Could not save",
      description: err instanceof Error ? err.message : undefined,
      color: "error",
      icon: "i-heroicons-exclamation-triangle",
    })
  }
}
```

Skip toasts on navigation-only actions (e.g. "clear filters") — only mutations that change server state get toasts.

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/dashboard && bunx vue-tsc --noEmit
git add apps/dashboard/app
git commit -m "feat(ui): toast feedback on every mutation (success + error)"
```

---

## Task 17: Dark-mode audit + polish

**Files:**
- Any page/component where dark mode reveals contrast or color issues

- [ ] **Step 1: Enable OS dark mode (or manual toggle in dev)**

Click theme toggle → Dark. Navigate every page in order:
1. Sign-in
2. Projects index
3. Project overview
4. Reports inbox (with + without open drawer)
5. Report drawer (all 8 tabs)
6. Members
7. Integrations
8. Project settings
9. Admin users
10. Install
11. Account

- [ ] **Step 2: Flag issues**

Common issues in Nuxt UI apps:
- Hard-coded `bg-white` / `text-neutral-900` that don't flip (replace with `bg-default` / `text-default`)
- Border colors that disappear in dark mode (replace with `border-default`)
- Low-contrast badges (check color variant picks)
- Icons stuck at a single color

Fix each and re-check.

- [ ] **Step 3: Commit**

```bash
git add apps/dashboard/app
git commit -m "fix(ui): dark-mode audit pass — semantic token cleanups"
```

---

## Task 18: Final verification + tag

- [ ] **Step 1: Lint + typecheck**

```bash
cd /Users/jiajingteoh/Documents/feedback-tool
bun run check
cd apps/dashboard && bunx vue-tsc --noEmit
```
Both clean.

- [ ] **Step 2: Full test suite (dev server must be running)**

```bash
bun run dev > /tmp/feedback-dev.log 2>&1 &
sleep 15
cd apps/dashboard && bun test
```
Expected: 150 pass / 1 skip / 0 fail (same baseline as before — tests are API-level, UI changes shouldn't affect them).

If any test fails because of a CSS selector or text-match change, update the test selector to match the new markup. That's mechanical.

- [ ] **Step 3: SDK tests still pass**

```bash
bun test packages
```
Expected: 181 pass / 0 fail (same as v0.7.1 baseline).

- [ ] **Step 4: Visual smoke checklist** (manual)

- Sidebar collapses + persists across reload
- Theme toggle flips all pages
- Inbox keyboard nav (`j`, `k`, `Enter`, `Esc`) works
- Drawer resize handle works + persists width
- Drawer re-mounts cleanly when switching reports (uses `:key="report.id"`)
- Toasts appear on save actions
- Empty states render in inbox when filters hide everything
- Install page shiki blocks render in both light + dark

- [ ] **Step 5: Tag**

```bash
git tag -a v0.7.2-frontend-overhaul -m "$(cat <<'EOF'
v0.7.2-frontend-overhaul — sub-project F complete

Full dashboard frontend rewrite on Nuxt UI v3 + Inter via @nuxt/fonts.

- New shell: project-scoped left sidebar + top bar (replaces max-w-6xl top-nav)
- System-aware dark mode across every page
- Resizable USlideover report drawer with always-visible triage footer
- Linear-style keyboard-first inbox (j/k/Enter/Esc)
- Shiki syntax highlighting on install page
- Toast feedback on every mutation
- Empty/loading/error state standardization
- Nuxt UI defaults held (primary: indigo, neutral: slate) — brand pass deferred

See docs/superpowers/specs/2026-04-18-frontend-overhaul-design.md for the
full design spec.
EOF
)"
```

- [ ] **Step 6: Confirm tag**

```bash
git tag -l | tail -5
```
Expected: `v0.7.2-frontend-overhaul` at bottom.
