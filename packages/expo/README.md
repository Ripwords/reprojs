# @reprojs/expo

Expo SDK for [Repro](https://github.com/Ripwords/reprojs) — submit annotated screenshots, logs, and device context to your self-hosted Repro dashboard.

## Install

```bash
npx expo install @reprojs/expo \
  react-native-view-shot react-native-svg react-native-gesture-handler \
  @react-native-async-storage/async-storage @react-native-community/netinfo \
  expo-device expo-constants \
  expo-document-picker expo-image-picker
```

Add the config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": ["@reprojs/expo"]
  }
}
```

## Usage

```tsx
import { ReproProvider, ReproLauncher, useRepro } from "@reprojs/expo"
import { GestureHandlerRootView } from "react-native-gesture-handler"

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ReproProvider
        config={{
          projectKey: "rp_pk_...",
          intakeUrl: "https://your-dashboard.com/api/intake",
        }}
      >
        <YourApp />
        <ReproLauncher />
      </ReproProvider>
    </GestureHandlerRootView>
  )
}

function MyScreen() {
  const repro = useRepro()
  return <Button title="Report" onPress={() => repro.open()} />
}
```

## Expo Go

This SDK depends on `react-native-view-shot`, which requires a development build. It will no-op in Expo Go with a dev-mode warning. Run `npx expo run:ios` or `npx expo run:android` to use the full SDK.

## What gets captured

Every report bundles:

- Annotated screenshot (PNG)
- Console logs (last 200 entries)
- Fetch network requests (last 100)
- User breadcrumbs (`repro.log(event, data)`)
- Device context: OS, version, model, app version, locale, connectivity

Session replay is **not** supported in the mobile SDK.

## License

MIT
