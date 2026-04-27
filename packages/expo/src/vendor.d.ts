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
