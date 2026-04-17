import type { StorageAdapter } from "./index"

export class S3Adapter implements StorageAdapter {
  put(): never {
    throw new Error("S3 storage not implemented in v1 (see sub-project F/G follow-up)")
  }
  get(): never {
    throw new Error("S3 storage not implemented in v1 (see sub-project F/G follow-up)")
  }
  delete(): never {
    throw new Error("S3 storage not implemented in v1 (see sub-project F/G follow-up)")
  }
}
