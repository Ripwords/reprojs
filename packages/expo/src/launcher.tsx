import React, { useEffect, useRef, useState } from "react"
import { Animated, Dimensions, Text, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useRepro } from "./use-repro"

type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left"
const CORNERS: Corner[] = ["bottom-right", "bottom-left", "top-right", "top-left"]
const STORAGE_KEY = "@reprojs/expo/launcher-corner/v1"
const SIZE = 52
const DEFAULT_MARGIN = 24

interface Props {
  position?: Corner
  offset?: { top?: number; bottom?: number; left?: number; right?: number }
  icon?: React.ReactNode
  hideWhen?: () => boolean
  /** When false the launcher stays pinned to `position`; when true (default)
   *  the user can drag it to any corner and the choice persists. */
  draggable?: boolean
}

function isCorner(v: unknown): v is Corner {
  return typeof v === "string" && (CORNERS as readonly string[]).includes(v)
}

function cornerCenter(
  corner: Corner,
  offset: NonNullable<Props["offset"]>,
  win: { width: number; height: number },
) {
  const top = offset.top ?? DEFAULT_MARGIN
  const bottom = offset.bottom ?? DEFAULT_MARGIN
  const left = offset.left ?? DEFAULT_MARGIN
  const right = offset.right ?? DEFAULT_MARGIN
  const x = corner.endsWith("right") ? win.width - right - SIZE / 2 : left + SIZE / 2
  const y = corner.startsWith("bottom") ? win.height - bottom - SIZE / 2 : top + SIZE / 2
  return { x, y }
}

export function ReproLauncher({
  position = "bottom-right",
  offset = {},
  icon,
  hideWhen,
  draggable = true,
}: Props) {
  const repro = useRepro()
  const [corner, setCorner] = useState<Corner>(position)
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current

  // Restore persisted corner on mount (only when draggable).
  useEffect(() => {
    if (!draggable) return
    let cancelled = false
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (!cancelled && isCorner(v)) setCorner(v)
        return undefined
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [draggable])

  // Persist corner changes.
  useEffect(() => {
    if (!draggable) return
    AsyncStorage.setItem(STORAGE_KEY, corner).catch(() => undefined)
  }, [corner, draggable])

  // `.runOnJS(true)` is required when the host app has react-native-reanimated;
  // without it setState inside a worklet crashes.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(6)
    .onUpdate((e) => {
      translate.setValue({ x: e.translationX, y: e.translationY })
    })
    .onEnd((e) => {
      const win = Dimensions.get("window")
      const fromAnchor = cornerCenter(corner, offset, win)
      const dropX = fromAnchor.x + e.translationX
      const dropY = fromAnchor.y + e.translationY
      const nextCorner: Corner = `${dropY < win.height / 2 ? "top" : "bottom"}-${
        dropX < win.width / 2 ? "left" : "right"
      }` as Corner
      const toAnchor = cornerCenter(nextCorner, offset, win)

      // Shift the translate baseline so the button visually stays where the
      // user released it, then spring to (0, 0) within the new corner.
      translate.setValue({ x: dropX - toAnchor.x, y: dropY - toAnchor.y })
      setCorner(nextCorner)
      Animated.spring(translate, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: true,
        speed: 14,
        bounciness: 6,
      }).start()
    })

  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(250)
    .onEnd(() => repro.open())

  const gesture = draggable ? Gesture.Race(pan, tap) : tap

  if (hideWhen?.()) return null
  if (repro.disabled) return null

  const posStyles = {
    position: "absolute" as const,
    top: corner.startsWith("top") ? (offset.top ?? DEFAULT_MARGIN) : undefined,
    bottom: corner.startsWith("bottom") ? (offset.bottom ?? DEFAULT_MARGIN) : undefined,
    left: corner.endsWith("left") ? (offset.left ?? DEFAULT_MARGIN) : undefined,
    right: corner.endsWith("right") ? (offset.right ?? DEFAULT_MARGIN) : undefined,
  }

  return (
    <View style={posStyles} pointerEvents="box-none">
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessibilityLabel="Report a bug"
          accessibilityRole="button"
          style={{
            transform: translate.getTranslateTransform(),
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
