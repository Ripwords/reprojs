import { customType } from "drizzle-orm/pg-core"
import { decrypt, encrypt } from "../lib/encryption"

/**
 * AES-256-GCM encrypted text column. Transparent encrypt on write / decrypt on read.
 * Requires the `ENCRYPTION_KEY` env var (base64-encoded 32 bytes — generate with
 * `openssl rand -base64 32`). Raises if the key is missing at the moment of use
 * rather than at module load, so schema imports don't explode in contexts
 * (e.g. migrations, type generation) where no encrypted rows are touched.
 */
export function encryptedText(name: string) {
  return customType<{
    data: string
    driverData: string
  }>({
    dataType() {
      return "text"
    },
    fromDriver(value: string): string {
      if (!value) return value
      const secret = process.env.ENCRYPTION_KEY
      if (!secret) throw new Error("ENCRYPTION_KEY environment variable is not set")
      return decrypt(value, secret)
    },
    toDriver(value: string): string {
      if (!value) return value
      const secret = process.env.ENCRYPTION_KEY
      if (!secret) throw new Error("ENCRYPTION_KEY environment variable is not set")
      return encrypt(value, secret)
    },
  })(name)
}
