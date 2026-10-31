import fs from "node:fs"

import archiver from "archiver"
import zipEncrypted from "archiver-zip-encrypted"

const g = globalThis as typeof globalThis & { __uploaderZipFormat?: boolean }
if (!g.__uploaderZipFormat) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  archiver.registerFormat("zip-encrypted", zipEncrypted as any)
  g.__uploaderZipFormat = true
}

/**
 * Compress `src` into `dest`. `zipPassword` encrypts the archive contents
 * (AES-256) and is independent of the share-link password gate.
 */
export function zipFile(
  src: string,
  dest: string,
  entryName: string,
  zipPassword?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest)
    const zip = zipPassword
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (archiver as any)("zip-encrypted", {
          zlib: { level: 1 },
          encryptionMethod: "aes256",
          password: zipPassword,
        })
      : archiver("zip", { zlib: { level: 1 } })

    out.on("close", () => resolve())
    out.on("error", reject)
    zip.on("error", reject)
    zip.pipe(out)
    zip.file(src, { name: entryName })
    void zip.finalize()
  })
}
