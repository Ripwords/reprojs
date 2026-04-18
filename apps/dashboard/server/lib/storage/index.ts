import { env } from "../env"

export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ key: string }>
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string }>
  delete(key: string): Promise<void>
}

let _adapter: StorageAdapter | null = null

export async function getStorage(): Promise<StorageAdapter> {
  if (_adapter) return _adapter
  if (env.STORAGE_DRIVER === "s3") {
    const { S3Adapter } = await import("./s3")
    _adapter = new S3Adapter()
    return _adapter
  }
  const { LocalDiskAdapter } = await import("./local-disk")
  _adapter = new LocalDiskAdapter(env.STORAGE_LOCAL_ROOT)
  return _adapter
}

export function _setStorageForTesting(a: StorageAdapter | null) {
  _adapter = a
}
