import type { RefObject } from "react"
import { captureRef } from "react-native-view-shot"
import * as FileSystem from "expo-file-system"
import type { View } from "react-native"

export interface CaptureResult {
  uri: string
  width: number
  height: number
  bytes: number
}

export async function captureView(ref: RefObject<View>): Promise<CaptureResult> {
  if (!ref.current) throw new Error("Repro: capture target not mounted")
  const uri = await captureRef(ref as RefObject<View>, {
    format: "png",
    quality: 1,
    result: "tmpfile",
    snapshotContentContainer: false,
  })
  const info = await FileSystem.getInfoAsync(uri, { size: true })
  return {
    uri,
    width: 0,
    height: 0,
    bytes: "size" in info && typeof info.size === "number" ? info.size : 0,
  }
}
