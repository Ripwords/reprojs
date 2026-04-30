import React, { useEffect, useMemo, useRef, useState } from "react"
import { Animated, Dimensions, Text, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useRepro } from "./use-repro"
import {
  type Anchor,
  type Corner,
  type OffsetInput,
  type WindowSize,
  LAUNCHER_SIZE,
  anchorToCenter,
  computeBounds,
  cornerToAnchor,
  isAnchor,
  nearestEdgeAnchor,
} from "./launcher-geometry"

const STORAGE_KEY_V1 = "@reprojs/expo/launcher-corner/v1"
const STORAGE_KEY_V2 = "@reprojs/expo/launcher-edge/v2"
const SIZE = LAUNCHER_SIZE

interface Props {
  /** Initial corner before any drag. After the first drag, the persisted edge
   *  position takes over (unless `draggable` is false). */
  position?: Corner
  offset?: OffsetInput
  icon?: React.ReactNode
  hideWhen?: () => boolean
  /** When false the launcher stays pinned to `position`; when true (default)
   *  the user can drag it anywhere along a screen edge (AssistiveTouch
   *  style) and the choice persists. */
  draggable?: boolean
}

function isCorner(v: unknown): v is Corner {
  return v === "bottom-right" || v === "bottom-left" || v === "top-right" || v === "top-left"
}

export function ReproLauncher({
  position = "bottom-right",
  offset = {},
  icon,
  hideWhen,
  draggable = true,
}: Props) {
  const repro = useRepro()
  const [anchor, setAnchor] = useState<Anchor>(() => cornerToAnchor(position))
  const [win, setWin] = useState<WindowSize>(() => {
    const w = Dimensions.get("window")
    return { width: w.width, height: w.height }
  })
  const bounds = useMemo(() => computeBounds(offset, win), [offset, win])

  // Animated.ValueXY drives the launcher's absolute top-left position. We
  // initialise it to the resolved center of the initial anchor so the button
  // doesn't visibly snap from (0,0) on first paint.
  const initialTopLeft = useMemo(() => {
    const c = anchorToCenter(cornerToAnchor(position), bounds)
    return { x: c.x - SIZE / 2, y: c.y - SIZE / 2 }
    // Run once: if `position`/`offset` change later, the anchor-spring effect
    // below catches up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const topLeft = useRef(new Animated.ValueXY(initialTopLeft)).current

  // JS-side mirror of the animated value so onStart can read it without
  // touching Animated's private `_value`.
  const topLeftRef = useRef(initialTopLeft)
  useEffect(() => {
    const id = topLeft.addListener((v) => {
      topLeftRef.current = v
    })
    return () => topLeft.removeListener(id)
  }, [topLeft])

  const dragStartRef = useRef({ x: 0, y: 0 })

  // Track window resize / rotation so the spring-on-anchor-change effect
  // recomputes against current dimensions.
  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setWin({ width: window.width, height: window.height })
    })
    return () => sub.remove()
  }, [])

  // Restore persisted anchor on mount. v2 stores the new {edge, along}; v1
  // stored a Corner string — we read v1 as a one-time fallback so users on the
  // previous SDK don't see the launcher jump on upgrade.
  useEffect(() => {
    if (!draggable) return
    let cancelled = false
    ;(async () => {
      try {
        const v2 = await AsyncStorage.getItem(STORAGE_KEY_V2)
        if (v2) {
          const parsed: unknown = JSON.parse(v2)
          if (!cancelled && isAnchor(parsed)) {
            setAnchor(parsed)
            return
          }
        }
        const v1 = await AsyncStorage.getItem(STORAGE_KEY_V1)
        if (!cancelled && isCorner(v1)) setAnchor(cornerToAnchor(v1))
      } catch {
        // Persistence is best-effort; a failure here just means the launcher
        // starts at `position` instead of the user's last drop.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [draggable])

  // Persist anchor changes.
  useEffect(() => {
    if (!draggable) return
    AsyncStorage.setItem(STORAGE_KEY_V2, JSON.stringify(anchor)).catch(() => undefined)
  }, [anchor, draggable])

  // Spring to the resolved center whenever the anchor or bounds (rotation,
  // offset prop change) change. Also covers the initial render — for which
  // the spring is a no-op since `topLeft` was already initialised there.
  useEffect(() => {
    const c = anchorToCenter(anchor, bounds)
    Animated.spring(topLeft, {
      toValue: { x: c.x - SIZE / 2, y: c.y - SIZE / 2 },
      useNativeDriver: true,
      speed: 14,
      bounciness: 6,
    }).start()
  }, [anchor, bounds, topLeft])

  // `.runOnJS(true)` is required when the host app has react-native-reanimated;
  // without it setState inside a worklet crashes.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(6)
    .onStart(() => {
      dragStartRef.current = { ...topLeftRef.current }
    })
    .onUpdate((e) => {
      // Free drag — finger drives the position directly. Edge-snap happens
      // on release, not during drag (matches iOS AssistiveTouch).
      topLeft.setValue({
        x: dragStartRef.current.x + e.translationX,
        y: dragStartRef.current.y + e.translationY,
      })
    })
    .onEnd((e) => {
      const dropCenterX = dragStartRef.current.x + e.translationX + SIZE / 2
      const dropCenterY = dragStartRef.current.y + e.translationY + SIZE / 2
      setAnchor(nearestEdgeAnchor({ x: dropCenterX, y: dropCenterY }, bounds))
    })

  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(250)
    .onEnd(() => repro.open())

  const gesture = draggable ? Gesture.Race(pan, tap) : tap

  if (hideWhen?.()) return null
  if (repro.disabled) return null

  return (
    <View
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      pointerEvents="box-none"
    >
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityLabel="Report a bug"
          accessibilityRole="button"
          style={{
            position: "absolute",
            transform: topLeft.getTranslateTransform(),
            width: SIZE,
            height: SIZE,
            borderRadius: SIZE / 2,
            backgroundColor: "#ff9b51",
            alignItems: "center",
            justifyContent: "center",
            shadowColor: "#ff9b51",
            shadowOpacity: 0.35,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          {icon ?? <Text style={{ color: "white", fontSize: 22 }}>🐞</Text>}
        </Animated.View>
      </GestureDetector>
    </View>
  )
}
