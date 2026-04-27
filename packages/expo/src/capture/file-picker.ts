import type { Attachment } from "@reprojs/sdk-utils"
import type { DocumentPickerResult } from "expo-document-picker"

type GetDocumentAsync = (opts?: {
  multiple?: boolean
  copyToCacheDirectory?: boolean
}) => Promise<DocumentPickerResult>

/**
 * Wraps expo-document-picker.getDocumentAsync. Returns an empty array on
 * cancel or when the picker module is unavailable. Each asset is converted
 * to an Attachment — the blob field is a placeholder Blob; the intake-client
 * uses the previewUrl (file:// uri) at submit time so we don't read every
 * file into memory the moment it's picked.
 */
export async function pickFiles({ multiple = true }: { multiple?: boolean } = {}): Promise<
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
      id: `picker-${Date.now()}-${i}`,
      blob: new Blob([], { type: mime }), // Placeholder — intake-client uses uri at submit time.
      filename: asset.name,
      mime,
      size: asset.size ?? 0,
      isImage: mime.startsWith("image/"),
      previewUrl: asset.uri,
    } satisfies Attachment
  })
}
