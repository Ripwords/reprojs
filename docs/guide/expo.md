# Expo SDK — install + setup

<img src="/expo/hero.svg" alt="Repro Expo SDK — wizard across three steps" style="width:100%;max-width:960px;border-radius:12px" />

`@reprojs/expo` drops a floating bug-report launcher into any Expo app. Reporters tap, annotate a captured screenshot, add context, and submit — the SDK bundles the annotated image plus console logs, fetch requests, breadcrumbs, and device info, and POSTs it to your Repro dashboard.

**Not session replay.** The mobile SDK does not record DOM — it captures a single screenshot + logs. That keeps the bundle small and the privacy story simple. The web SDK ([`@reprojs/core`](./sdk)) is where replay lives.

## Install

```bash
# From inside your Expo app (not the monorepo root)
npx expo install @reprojs/expo \
  react-native-view-shot react-native-svg react-native-gesture-handler \
  @react-native-async-storage/async-storage @react-native-community/netinfo \
  expo-device expo-constants \
  expo-document-picker expo-image-picker
```

`expo install` picks versions matching your Expo SDK channel.

### Minimum versions

| Peer | Minimum |
| --- | --- |
| `expo` | 52.0 |
| `react-native` | 0.74 |
| `react` | 18.3 |
| `react-native-view-shot` | 3.8 |
| `react-native-svg` | 15 |
| `react-native-gesture-handler` | 2.16 |
| `@react-native-async-storage/async-storage` | 1.23 |
| `@react-native-community/netinfo` | 11.3 |
| `expo-device` | 6 |
| `expo-constants` | 16 |
| `expo-document-picker` | any (matches your Expo SDK) |
| `expo-image-picker` | any (matches your Expo SDK) |

## Add the config plugin

In `app.json` (or `app.config.ts`), add `@reprojs/expo` to the `plugins` array:

```json
{
  "expo": {
    "plugins": ["@reprojs/expo"]
  }
}
```

The plugin is a no-op in v1 — it exists so that future native additions (camera-roll permission strings, bundle-id allowlist) don't require a breaking migration.

## Wrap your app root

Anywhere near the top of your React tree (typically `app/_layout.tsx` with expo-router):

```tsx
import { ReproProvider, ReproLauncher } from "@reprojs/expo"
import { GestureHandlerRootView } from "react-native-gesture-handler"

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ReproProvider
        config={{
          projectKey: process.env.EXPO_PUBLIC_REPRO_PROJECT_KEY ?? "",
          intakeUrl: process.env.EXPO_PUBLIC_REPRO_INTAKE_URL ?? "",
        }}
      >
        <YourApp />
        <ReproLauncher />
      </ReproProvider>
    </GestureHandlerRootView>
  )
}
```

- `<ReproProvider>` **must** be inside `<GestureHandlerRootView>` — the annotation canvas needs gesture-handler at the root.
- `<ReproLauncher />` is opt-in. You can also trigger the wizard imperatively via `useRepro().open()` or `Repro.open()`.

## Silent disable

Both `projectKey` and `intakeUrl` default-to-empty via `process.env.X ?? ""`. **When either is empty, the entire SDK disables itself silently** — no collectors start, no launcher renders, `useRepro().disabled` is `true` and all methods no-op. This is the idiomatic "turn it off in prod / turn it on in staging" switch:

```env
# .env.development
EXPO_PUBLIC_REPRO_PROJECT_KEY=rp_pk_xxxxxxxxxxxxxxxxxxxxxxxx
EXPO_PUBLIC_REPRO_INTAKE_URL=http://10.0.0.42:3000/api/intake

# .env.production — leave blank to skip Repro entirely
```

A typo'd non-empty key (say `rp_pk_shortkey`) still throws a `Repro: invalid projectKey shape` at provider mount, so you don't accidentally ship a silently-disabled build.

## First report

1. `npx expo run:ios` (or `run:android`) — Expo Go is not supported because `react-native-view-shot` needs a dev build.
2. Tap the flame-orange bug button.
3. Fill out title + description → **Continue**.
4. Annotate the captured screenshot with the pen/arrow/rect/highlight/text tools → **Continue**.
5. Review what's included → **Send report**.

The report lands in your dashboard's inbox with a Mobile / iOS / Android platform pill and a mobile-specific device card.

## Draggable launcher

The launcher is draggable to any of the four corners. Drag anywhere on screen, release, and it snaps (spring-animated) to the nearest corner. The choice persists across app restarts via AsyncStorage. Disable the behavior if you want a fixed position:

```tsx
<ReproLauncher draggable={false} position="top-right" />
```

## What gets captured

- **Screenshot** — single annotated PNG. Flattened client-side into a transparent-letterbox PNG so the host app's dark surface shows through on the dashboard.
- **Console** — last 200 entries of `console.log / info / warn / error / debug`. Stack traces on warn + error.
- **Network** — last 100 `fetch` calls. Method, URL, status, duration, bytes, headers. Headers `authorization`, `cookie`, `x-api-key` are redacted by default. XHR patching is v1.1.
- **Breadcrumbs** — custom events via `useRepro().log(event, data)`. Last 50.
- **Device** — iOS/Android, OS version, device model, app version + build, locale, timezone, viewport + screen size, DPR, connectivity (`4g`, `wifi`, etc.).

## Offline queue

Reports that fail to POST (no network, 5xx, etc.) are persisted to AsyncStorage under `@reprojs/expo/queue/v1` (max 5 reports or 10 MB, whichever first). They retry with exponential backoff when:

- `NetInfo` reports online after being offline
- The app comes to foreground (`AppState` change)
- The host calls `useRepro().queue.flush()` manually

The queue is not encrypted — documented privacy tradeoff for v1. Don't use as a session vault for secrets.

## Troubleshooting

- **`TypeError: null is not an object (evaluating 'RNViewShot.captureRef')`** — the native `view-shot` module isn't linked. Run `npx expo prebuild --clean && npx expo run:ios` after installing the peer deps.
- **`Origin header required` (403 on submit)** — your dashboard is an older build without the Expo-source relaxation. Update to a version that includes the additive intake changes.
- **`Submission too fast` (400)** — the server's dwell gate (default 1000 ms) didn't pass. The SDK clamps to ≥1000 ms so this is only seen if you're running an older SDK build.
- **Wizard opens but screenshot area is blank** — `react-native-view-shot` returned without an error but produced a black frame. Usually resolved by dismissing the keyboard before opening the wizard.
- **Annotations don't appear in the submitted PNG** — older SDK bug; update to ≥0.1.0.

## Next

- [API reference](./expo-api) — all props, hooks, and types
- [Architecture](./architecture) — how the SDK and dashboard talk
- [Self-host the dashboard](/self-hosting/) — where reports land
