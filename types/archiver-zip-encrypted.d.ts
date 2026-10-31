declare module "archiver-zip-encrypted" {
  import type { Transform } from "node:stream"

  interface EncryptedZipOptions {
    zlib?: { level?: number }
    encryptionMethod?: "aes256" | "zip20"
    password: string
  }

  /** Format registered with `archiver.registerFormat("zip-encrypted", ...)`. */
  const format: (options?: EncryptedZipOptions) => Transform
  export default format
}
