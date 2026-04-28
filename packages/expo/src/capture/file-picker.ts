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

type HasImageAsync = () => Promise<boolean>
type GetImageAsync = (opts?: { format?: "png" | "jpeg" }) => Promise<{
  data: string
  size: { width: number; height: number }
} | null>

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

/**
 * Read a single image off the system clipboard. Returns an empty array
 * when the clipboard has no image, when expo-clipboard or expo-file-system
 * are unavailable, or when the user denied access. We write the base64
 * payload to expo-file-system's cache directory and pass the resulting
 * `file://` URI through `previewUrl`, matching the contract used by the
 * other pickers — RN's Blob polyfill rejects ArrayBuffer/Uint8Array
 * inputs, so we must NOT construct `new Blob([bytes])`.
 */
export async function pickFromClipboard(): Promise<Attachment[]> {
  let hasImage: HasImageAsync | undefined
  let getImage: GetImageAsync | undefined
  try {
    const mod = await import("expo-clipboard")
    hasImage = mod.hasImageAsync
    getImage = mod.getImageAsync
  } catch {
    return []
  }
  if (!hasImage || !getImage) return []

  const present = await hasImage()
  if (!present) return []

  const result = await getImage({ format: "png" })
  if (!result?.data) return []

  // Clipboard data may arrive as raw base64 (iOS) or as a full data: URI
  // (Android). Strip any prefix so we hand the file system pure base64.
  const base64 = result.data.replace(/^data:[^;]+;base64,/, "")
  const sizeBytes = Math.floor((base64.length * 3) / 4)

  let cacheDirectory: string | null = null
  let writeAsStringAsync:
    | ((uri: string, contents: string, opts?: { encoding?: "utf8" | "base64" }) => Promise<void>)
    | undefined
  try {
    const fs = await import("expo-file-system")
    cacheDirectory = fs.cacheDirectory
    writeAsStringAsync = fs.writeAsStringAsync
  } catch {
    return []
  }
  if (!cacheDirectory || !writeAsStringAsync) return []

  const filename = `pasted-${Date.now()}.png`
  const uri = `${cacheDirectory}${filename}`
  await writeAsStringAsync(uri, base64, { encoding: "base64" })

  const mime = "image/png"
  return [
    {
      id: makeAttachmentId("clip", 0),
      // Empty placeholder blob — same pattern as pickFromFiles /
      // pickFromPhotos. The real bytes live at `previewUrl` and are
      // streamed by RN's FormData {uri, name, type} shorthand at submit.
      blob: new Blob([], { type: mime }),
      filename,
      mime,
      size: sizeBytes,
      isImage: true,
      previewUrl: uri,
    },
  ]
}
