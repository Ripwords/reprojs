import type { RefObject } from "react"
import { captureRef } from "react-native-view-shot"
import type { View } from "react-native"

export interface CaptureResult {
  uri: string
  width: number
  height: number
}

export async function captureView(ref: RefObject<View | null>): Promise<CaptureResult> {
  if (!ref.current) throw new Error("Repro: capture target not mounted")
  const uri = await captureRef(ref as RefObject<View>, {
    format: "png",
    quality: 1,
    result: "tmpfile",
    snapshotContentContainer: false,
  })
  // width/height are filled by the caller that holds the measured layout size.
  return { uri, width: 0, height: 0 }
}
