import type { Attachment } from "@reprojs/sdk-utils"
import type { DocumentPickerResult } from "expo-document-picker"
import type { ImagePickerResult } from "expo-image-picker"

type GetDocumentAsync = (opts?: {
  multiple?: boolean
  copyToCacheDirectory?: boolean
}) => Promise<DocumentPickerResult>

type LaunchImageLibraryAsync = (opts?: {
  mediaTypes?: "All" | "Images" | "Videos" | string[]
  allowsMultipleSelection?: boolean
  quality?: number
  selectionLimit?: number
}) => Promise<ImagePickerResult>

function makeAttachmentId(prefix: string, i: number): string {
  return `${prefix}-${Date.now()}-${i}`
}

/**
 * Pick from the system file picker (Documents app on iOS, system picker on
 * Android). Accepts any file type — same as the web SDK. Each asset is
 * converted to an Attachment whose blob is a placeholder; the intake client
 * streams from the previewUrl (file:// uri) at submit time.
 */
export async function pickFromFiles({ multiple = true }: { multiple?: boolean } = {}): Promise<
  Attachment[]
> {
  let getDocumentAsync: GetDocumentAsync | undefined
  try {
    const mod = await import("expo-document-picker")
    getDocumentAsync = mod.getDocumentAsync
  } catch {
    return []
  }
  if (!getDocumentAsync) return []

  const result = await getDocumentAsync({
    multiple,
    copyToCacheDirectory: true,
  })

  if (result.canceled || !result.assets) return []

  return result.assets.map((asset, i) => {
    const mime = asset.mimeType ?? "application/octet-stream"
    return {
      id: makeAttachmentId("doc", i),
      blob: new Blob([], { type: mime }),
      filename: asset.name,
      mime,
      size: asset.size ?? 0,
      isImage: mime.startsWith("image/"),
      previewUrl: asset.uri,
    } satisfies Attachment
  })
}

/**
 * Pick from the device's photo library. Image-only by design — videos can
 * be added later if users ask. Filename is derived from the picker's
 * fileName (Android) or from the URI's tail when iOS doesn't provide one.
 */
export async function pickFromPhotos({ multiple = true }: { multiple?: boolean } = {}): Promise<
  Attachment[]
> {
  let launch: LaunchImageLibraryAsync | undefined
  try {
    const mod = await import("expo-image-picker")
    launch = mod.launchImageLibraryAsync
  } catch {
    return []
  }
  if (!launch) return []

  const result = await launch({
    mediaTypes: "Images",
    allowsMultipleSelection: multiple,
    quality: 1,
    selectionLimit: multiple ? 0 : 1,
  })

  if (result.canceled || !result.assets) return []

  return result.assets.map((asset, i) => {
    const mime = asset.mimeType ?? "image/jpeg"
    const tail = asset.uri.split("/").pop() ?? `photo-${i}`
    const filename = asset.fileName ?? tail
    return {
      id: makeAttachmentId("photo", i),
      blob: new Blob([], { type: mime }),
      filename,
      mime,
      size: asset.fileSize ?? 0,
      isImage: true,
      previewUrl: asset.uri,
    } satisfies Attachment
  })
}

// Clipboard paste was prototyped here but removed from the Expo SDK: on
// iOS the system paste prompt is surprising in a bug-report flow, and the
// failure modes (Continuity Clipboard, custom UTIs, denial) made it more
// confusing than useful. File + Photos picker covers the realistic asks.
// The web SDK keeps clipboard paste because the desktop Ctrl/⌘-V model is
// unambiguous.
