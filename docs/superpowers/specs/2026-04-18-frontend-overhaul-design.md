# Dashboard Frontend Overhaul — Design Spec

**Sub-project F.** Replace the dashboard's skeleton Tailwind styling with a professional, polished visual system. Single-release full sweep of every page shell, built on Nuxt UI v3 + Tailwind v4 + Inter via `@nuxt/fonts`.

**Scope**: `apps/dashboard/app/` only. Server code, API contracts, SDK, and the SDK widget UI (Preact/Shadow DOM) are out of scope.

**Aesthetic reference**: Linear's density and keyboard-first triage flow + Nuxt.com's typography hierarchy + Marker.io and Mastra.ai's restrained use of gradient accents for hero moments.

**Status**: design approved, awaiting user sign-off on the written spec before implementation plan.

## 1. Goals and Non-Goals

**Goals**

- Replace every page shell with the new sidebar + top-bar layout.
- Adopt Nuxt UI v3 as the component library; all data-dense surfaces (inbox, drawer, tables) use its components or shadcn-style customized variants in `app/components/ui/`.
- Ship system-aware dark mode across every page.
- Standardize empty / loading / error / success state patterns.
- Professional typography (Inter + JetBrains Mono) via `@nuxt/fonts` with subsetting + self-hosting + fallback-metric CLS reduction.
- Keyboard-first inbox triage (`↓/↑/Enter/Esc`, `j/k` within drawer).
- Resizable report drawer replacing the fixed side panel.

**Non-goals (v1)**

- Mobile-optimized triage flow. Responsive is best-effort (≥768 px is supported; <768 px is navigable but not polished).
- Full `Cmd+K` command palette contents — wiring is present; only the project switcher is populated.
- Brand color selection — stays on Nuxt UI default `primary: indigo` until a separate v0.7.3 brand pass.
- Page transitions and spring/bounce animations.
- Custom illustrations for empty states — icon + typography is enough for v1.
- Storybook / component catalog.
- Email template restyling (separate concern; HTML-email constraints differ).
- Playwright e2e — still deferred per CLAUDE.md §5.3.

## 2. Core Decisions

| Area | Decision | Rationale |
|---|---|---|
| Component library | **Nuxt UI v3** | Tailwind-native (no CSS specificity fights with our Tailwind v4 setup), built by the Nuxt team for Nuxt, shadcn-style escape hatch (copy a component into `app/components/ui/` to customize), ~40-60 KB gzipped runtime for the default set. PrimeVue was rejected (not Tailwind-native, style duplication); pure Tailwind + Reka UI was rejected (re-implements every primitive — doubles scope). |
| Tailwind integration | **Keep existing `@tailwindcss/vite` + `@import "tailwindcss"`** | Already matches Tailwind's official Nuxt guide. No migration to `@nuxt/tailwindcss` module. |
| Font loading | **`@nuxt/fonts`** | Official Nuxt team package; handles subsetting, self-hosting, `font-display: swap`, automatic fallback metric calculation to reduce CLS. Uses `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` as source. |
| Color tokens | **Nuxt UI defaults: `primary: indigo`, `neutral: slate`** | Swap brand color later in a one-line change; avoids bikeshedding during the structural overhaul. |
| Dark mode | **System-aware**, manual toggle in user menu | Every surface reviewed in both modes before shipping. |
| Shell | **Project-scoped left sidebar + top bar**, full-width pages | Matches how the app is actually used (most time inside one project bouncing between Reports + one other page). Inbox genuinely wants full width. |
| Release shape | **Single-release full sweep** | User preference. Internally sequenced (foundation → shell → tokens → page sweep → polish) for safety, but one merged tag. |
| Responsive posture | **Desktop-first ≥1024 px**, tablet collapses sidebar to icon rail, mobile best-effort | Dev tools hit desktop 95%+; mobile-first polish is a big scope multiplier not warranted for v1. |
| Typography | **Inter (sans) + JetBrains Mono (code)** | Industry standard for dashboards (Vercel, Linear, Stripe); excellent at small table-row sizes. Geist was rejected as too associated with Vercel's identity. |
| Icons | **Heroicons (outline for nav/actions, solid for status) + Simple Icons (brand marks only)** | Two-family ceiling so the visual vocabulary stays consistent. Nuxt UI's Iconify resolver handles on-demand loading (0 initial bundle cost). |
| Syntax highlighting | **`shiki`**, lazy-imported | ~100 KB lazy-loaded only on Install / Raw / Console tabs. Not in the initial bundle. |

## 3. Architecture

### Shell

Single rewrite of `layouts/default.vue`:

```
┌───────────────────────────────────────────────────────────────┐
│  TopBar  [ProjectSwitcher ▾]           [?] [ThemeToggle] [👤] │
├──────────┬────────────────────────────────────────────────────┤
│ Sidebar  │                                                    │
│          │                                                    │
│ ◈ Overv. │              Page content                          │
│ ● Reports│              (full-width, no max-w cap)            │
│ ▲ Members│                                                    │
│ ◐ Integr.│                                                    │
│ ◔ Setting│                                                    │
│  ────    │                                                    │
│  Admin   │                                                    │
│ ◎ Users  │                                                    │
│ ◇ Install│                                                    │
└──────────┴────────────────────────────────────────────────────┘
```

- **Sidebar** (`UNavigationMenu` vertical): 240 px expanded, 56 px icon rail collapsed. State persisted in `useCookie("sidebar-collapsed")`. Tablet auto-collapses. Project-scope items appear only inside `/projects/[id]/*`. Admin-scope items appear only for `role === "admin"`, separated by divider + "Admin" sublabel. Reports item shows a `UBadge` with open-count.
- **Top bar** (`UHeader`): height 48 px, border-bottom only. Left: project switcher trigger. Right cluster: help link, theme toggle, user popover (avatar → account / sign out). `Cmd+K` command-palette trigger is present but v1 only shows the project switcher.
- **Auth layout** (`layouts/auth.vue`): unchanged structure, restyled with Inter + gradient wash background (Marker.io-inspired hero feel) on sign-in.

### Page inventory

| Page | Layout | Primary Nuxt UI components |
|---|---|---|
| `/` (projects index) | Grid of project cards | `UCard`, `UButton`, `UBadge`, empty-state CTA |
| `/projects/[id]/index` (overview) | Metric tiles + recent activity + recent reports | `UCard` tiles, `UTable` for recents |
| `/projects/[id]/reports` (inbox) | Facets rail + table + slideover drawer | `UTable` (dense), `UInput` search, `USelectMenu` filters, `USlideover` |
| `/projects/[id]/members` | Members table + invite modal | `UTable`, `UModal`, `USelectMenu` for role |
| `/projects/[id]/integrations` | Card per integration provider | `UCard`, `UButton`, `UAvatar` for provider icons |
| `/projects/[id]/settings` | Tab-sectioned form | `UTabs`, `UForm`, `UFormField`, `UInput`, `USwitch`, `UTextarea` |
| `/settings/users` | Users table + invite | `UTable`, `UModal` |
| `/settings/install` | Long-form doc with code | `UAccordion`, `UKbd`, syntax-highlighted `shiki` blocks |
| `/settings/account` | Form + sessions panel | `UForm`, `UCard`, `UButton.Group` |
| `/auth/sign-in` | Centered card on gradient | `UCard`, `UInput`, `UButton`, `UDivider` |

### Inbox triage flow

Full-width layout, three vertical panes:

```
┌─ Top bar ────────────────────────────────────────────────────┐
│ [Search...]   [Status: Open ▾] [Priority ▾] [Assignee ▾] ⋯   │
├───────────┬──────────────────────────────────────────────────┤
│ Status    │ ✓ │ Title              │ Assignee │ Reporter │ ● │
│ ● Open 42 │ ▢ │ Cart submit hangs  │ JJ       │ user@... │ 2h│
│ ◐ In 3    │ ▢ │ Logo misaligned    │ –        │ alex@... │ 4h│
│ ● Resolve │ ▢ │ 500 on /checkout   │ Sam      │ –        │ 1d│
│ ◌ Closed  │ ▢ │ ...                │          │          │   │
│ Priority  │                                                  │
│  🔴 Urgent│                                                  │
│  🟡 High  │                                                  │
│  ⚪ Normal│                                                  │
│  ⚪ Low   │                                                  │
│ Tags      │                                                  │
│  [auth]   │                                                  │
└───────────┴──────────────────────────────────────────────────┘
```

**Table**: `UTable` dense (36 px row height), zebra off, hover bg `bg-neutral-50/50`, row click opens drawer. Keyboard `↓/↑` navigates, `Enter` opens, `Esc` closes (Linear pattern).

**Bulk select**: row checkbox. Selecting ≥1 row transforms the top search bar into a `BulkActionBar` (rebuilt from existing `bulk-action-bar.vue` with Nuxt UI `UButton.Group`).

**Columns**: sortable via `UTable` native; default `created_at desc`. Status / Priority / Tag columns render as `UBadge` with color variant mapped from enum (`open → info`, `in_progress → warning`, `resolved → success`, `closed → neutral`). Relative time ("2h") in a `UTooltip` showing absolute timestamp on hover.

**Facets rail** (240 px): `UButton variant="ghost"` per facet with right-aligned `UBadge` count. Active filter gets `variant="soft" color="primary"`.

**Empty / loading**: `UEmptyState` for no-data, with icon + headline + subtext + CTA ("Install the SDK" if never received any report; "Filters might be hiding reports" if filters are applied). Loading uses `USkeleton` rows matching the real layout — never a centered spinner.

### Report drawer

Moves from fixed side panel to `USlideover` right-anchored, resizable:

```
┌─ 470px (resizable, persisted in useCookie) ─────────────┐
│ ← Close                        [≡ Actions ▾]           │
│                                                         │
│ Cart submit hangs                           🔴 Urgent   │
│ http://checkout.example.com/cart · 2h ago               │
├─────────────────────────────────────────────────────────┤
│ [Overview] [Console] [Network] [Replay] [Activity] ... │
├─────────────────────────────────────────────────────────┤
│                                                         │
│   ...active tab content...                              │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Status: [Open▾]  Assignee: [Me▾]  Priority: [High▾]    │
│ Tags: [auth ✕] [ui ✕] [+]                              │
└─────────────────────────────────────────────────────────┘
```

- **Header**: title + page URL + relative time + top-right priority badge + actions menu (Create GitHub issue, Copy link, Delete).
- **Tabs** (`UTabs` horizontal, scrolling on narrow width): Overview / Console / Network / Replay / Activity / Cookies / System / Raw. Each tab label shows a dot indicator when that tab has data (e.g. Console tab shows `●` if there are any errors).
- **Triage footer** (always visible — not a tab): status, assignee, priority, tags as inline `USelectMenu` + `UBadge` controls. Changes autosave optimistically; toast on failure. Replaces the current separate `triage-panel.vue`.
- **Resize**: drag handle on the left edge. Min 400 px, max 800 px. Persisted in `useCookie("drawer-width")`.
- **Keyboard**: `j/k` navigate reports within the drawer (moves selection in the background table), `Esc` closes, `c` reserved for a future comment composer.
- **Console / Network / Replay tabs**: inherit existing content, restyled. Console uses `UAccordion` for stack traces; monospace (JetBrains Mono); color-coded `UBadge` for level. Network uses `UTable` dense, URL column truncated with tooltip, status badge colored by 2xx/3xx/4xx/5xx. Replay keeps the existing lazy-loaded `rrweb-player`, rehoused in a card shell matching other tabs.

## 4. States, patterns, micro-interactions

| State | Pattern | Component |
|---|---|---|
| Empty (no data yet) | Icon + headline + subtext + primary CTA; gradient accent on first-run empty states, plain for "filters hid everything" | `UEmptyState` or wrapper `AppEmptyState.vue` |
| Loading | `USkeleton` shapes matching the real layout | Inline per-component |
| Error (fetch failed) | Soft red card, error message, "Retry" button, "Copy error" link for debug | Custom `AppErrorState.vue` |
| Form validation error | Inline `UFormField` error slot, `role="alert"`, no modal/toast for field-level | Nuxt UI default |
| Destructive confirm | `UModal` with red primary button; high-risk deletes (delete project) require typing resource name | Custom `ConfirmDeleteDialog.vue` |
| Success / info feedback | `useToast()`, top-right, 3.5s auto-dismiss, never blocks flow | Nuxt UI default |

**Loading discipline**: page-level loading shows `USkeleton` for everything above the fold; don't mix partial real data + skeletons. Action loading: button `loading` prop shows inline spinner and disables the button for the duration. Table bulk updates are optimistic — rows update immediately, rollback on error with a toast.

**Micro-interactions** (sparing, Linear-level restraint):
- Hover transitions: `transition-colors duration-150` on buttons/rows; no transform/scale.
- Drawer open/close: `USlideover` built-in slide (200 ms).
- Toasts: Nuxt UI default (subtle slide-up, fade).
- Page transitions: **none** — SPA route change is instant, transitions feel laggy on dev tools.
- No spring physics, no bounce.

**Gradient accents** (Mastra-style, used sparingly):
- Auth layout background (sign-in)
- First-run empty states ("No projects yet", "No reports yet")
- Activation CTAs on fresh project overview
- Never on recurring surfaces (cards, table rows, nav items)

**Keyboard shortcuts**: `useKeyboardShortcuts(['j','k','enter','esc'], handler)` composable. A `?` key opens a cheat-sheet `UModal` listing all shortcuts for the current page.

**Typography scale** (Tailwind-native, Nuxt UI defaults):
- `text-xs` (12 px) — table meta (timestamps, counts), tooltip content
- `text-sm` (14 px) — primary body, labels, form inputs
- `text-base` (16 px) — page body prose (sign-in, empty-state descriptions)
- `text-lg` (18 px) — card titles, drawer tab labels
- `text-xl` (20 px) — page headings
- `text-2xl` (24 px) — page primary heading (H1)
- Weights: 400 body, 500 labels/table headers, 600 headings, 700 rare.

**Code display** (console tab, raw tab, install docs): JetBrains Mono or `ui-monospace` fallback; `shiki` syntax highlighting (lazy-imported); `UKbd` component for keyboard shortcuts.

**Accessibility baseline**: Nuxt UI components ship correct ARIA and focus rings. `prefers-reduced-motion` is auto-respected. Target AA color contrast for body text, AAA where cheap.

## 5. Migration, testing, risks

### Migration sequence (internal to the single release)

1. **Foundation**: install `@nuxt/ui`, `@nuxt/fonts`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`, `shiki`. Wire the `@nuxt/ui` module. Verify app boots and existing pages still render.
2. **Shell + layout rewrite**: new `layouts/default.vue` with sidebar + top bar. Every existing page renders inside the new chrome but keeps its current body. Regression-check navigation.
3. **Tokens + typography**: `@theme` block in the Tailwind CSS file, font family via `@nuxt/fonts`, semantic color tokens (`primary`, `neutral`). Audit any hard-coded neutral/background classes that need semantic swaps for clean dark-mode flip.
4. **Page sweep** (one at a time, each a standalone commit, ordered by user impact):
   1. Reports (inbox + drawer) — the most complex and most-used
   2. Project Overview
   3. Members
   4. Integrations
   5. Project Settings
   6. Admin Users
   7. Install
   8. Projects Index
   9. Sign-in
5. **Polish pass**: toasts on every mutation, empty states everywhere, loading states everywhere, full dark-mode audit with OS dark mode on.

### Dependency budget (dashboard only, SDK unaffected)

- `@nuxt/ui` — ~40-60 KB gzipped runtime, tree-shaken per-component
- `@nuxt/fonts` — 0 runtime (build-time only)
- `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` — ~50 KB self-hosted
- `shiki` — ~100 KB lazy-imported; used only on 3 pages (install / raw / console)
- `@iconify/json` — on-demand via Nuxt UI's icon resolver, 0 initial cost

### Testing strategy

- **Existing tests must pass**: 150 dashboard tests run green. API contracts unchanged. Tests that select by CSS class or text may need selector updates — mechanical churn, expected.
- **Visual smoke checklist** (manual, documented in the plan): every page loads in light + dark mode; sidebar collapse works; drawer opens + resizes; empty states render; one mutation per page shows a toast; keyboard shortcuts work in the inbox.
- **Accessibility spot-checks**: tab through each page — every interactive element reachable with visible focus ring; drawer traps focus.
- **No Playwright** — deferred per CLAUDE.md §5.3. If a specific regression risk emerges, add a targeted e2e test for it.

### Risk register

- **`UTable` dense-mode rough edges**: if row-height < 40 px bites visually or interactively, drop to a custom table built on `@tanstack/vue-table` + Tailwind. Contained per-page fallback.
- **Dark mode audit always exceeds estimates**: budget explicit time; don't eyeball each page.
- **`shiki` bundle weight**: if too heavy, swap to `@wooorm/starry-night` or drop syntax highlighting on the console tab (keep it only on install docs).
- **Nuxt UI v3 API churn**: v3 is mature at this point but minor version bumps occasionally rename props. Pin to a specific minor in the plan.

## 6. Out of Scope (intentionally deferred)

- Full command palette contents (`Cmd+K` wired for project switcher only; full global nav/search is a follow-up)
- Mobile-optimized triage flow
- Brand color selection (stays `indigo`)
- Page transitions and spring/bounce animations
- Custom illustrations for empty states
- Storybook / component catalog
- Email template restyling
- Playwright e2e coverage

## 7. Implementation skill reference

The implementation plan will invoke `frontend-design:frontend-design` during execution of the page-sweep phase for per-page design judgment. Brainstorming's hard-gate means `frontend-design` can't be invoked here — `writing-plans` is the only skill brainstorming hands off to, and `frontend-design` is invoked from within individual plan tasks.
