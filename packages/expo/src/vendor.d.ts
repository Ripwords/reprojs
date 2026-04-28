/**
 * Ambient stub for optional peer dependencies that are not installed in the
 * workspace but must be importable at runtime in the host app.
 */

declare module "expo-document-picker" {
  export interface DocumentPickerAsset {
    uri: string
    name: string
    mimeType?: string
    size?: number
  }

  export type DocumentPickerResult =
    | { canceled: true; assets?: never }
    | { canceled: false; assets: DocumentPickerAsset[] }

  export function getDocumentAsync(options?: {
    multiple?: boolean
    copyToCacheDirectory?: boolean
    type?: string | string[]
  }): Promise<DocumentPickerResult>
}

declare module "expo-image-picker" {
  export interface ImagePickerAsset {
    uri: string
    fileName?: string | null
    mimeType?: string
    fileSize?: number
    width?: number
    height?: number
    type?: "image" | "video"
  }

  export type ImagePickerResult =
    | { canceled: true; assets?: never }
    | { canceled: false; assets: ImagePickerAsset[] }

  export const MediaTypeOptions: {
    All: "All"
    Images: "Images"
    Videos: "Videos"
  }

  export function launchImageLibraryAsync(options?: {
    mediaTypes?: "All" | "Images" | "Videos" | string[]
    allowsMultipleSelection?: boolean
    quality?: number
    selectionLimit?: number
  }): Promise<ImagePickerResult>

  export function requestMediaLibraryPermissionsAsync(): Promise<{
    status: "granted" | "denied" | "undetermined"
    granted: boolean
  }>
}

declare module "expo-clipboard" {
  export function hasImageAsync(): Promise<boolean>
  export function getImageAsync(opts?: { format?: "png" | "jpeg" }): Promise<{
    data: string
    size: { width: number; height: number }
  } | null>
}

declare module "expo-file-system" {
  export const cacheDirectory: string | null
  export const documentDirectory: string | null
  export function writeAsStringAsync(
    fileUri: string,
    contents: string,
    options?: { encoding?: "utf8" | "base64" },
  ): Promise<void>
  export function getInfoAsync(fileUri: string): Promise<{
    exists: boolean
    size?: number
    uri: string
  }>
}
