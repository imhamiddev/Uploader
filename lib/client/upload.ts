import { api, ApiError, SESSION_EXPIRED, setUnauthorizedHandler } from "./api"

export interface UploadOptions {
  password: string
  zip: boolean
  zipPassword: string
  expiresAt: number | null
  rename: boolean
  name: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function putChunk(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open("PUT", url)
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded)
    x.onload = () => {
      if (x.status === 401) {
        window.dispatchEvent(new Event("uploader:unauthorized"))
        return reject(new ApiError(SESSION_EXPIRED, 401))
      }
      if (x.status >= 200 && x.status < 300) return resolve()
      let message = "خطا " + x.status
      try {
        message = JSON.parse(x.responseText).error || message
      } catch {
        /* keep default */
      }
      reject(new ApiError(message, x.status))
    }
    x.onerror = () => reject(new ApiError("قطع ارتباط", 0))
    x.send(blob)
  })
}

/**
 * Chunked upload: each 5 MB piece is retried up to five times, so a flaky
 * connection or a proxy request limit never breaks a large file.
 */
export async function uploadOne(
  file: File,
  opts: UploadOptions,
  onProgress: (fraction: number) => void
): Promise<void> {
  const { id, chunkSize } = await api<{ id: string; chunkSize: number }>(
    "/api/upload/init",
    { method: "POST", json: { name: file.name, size: file.size } }
  )

  try {
    let done = 0
    for (let off = 0, i = 0; off < file.size; off += chunkSize, i++) {
      const blob = file.slice(off, Math.min(off + chunkSize, file.size))
      for (let attempt = 1; ; attempt++) {
        try {
          await putChunk(`/api/upload/${id}/${i}`, blob, (l) =>
            onProgress((done + l) / file.size)
          )
          break
        } catch (e) {
          if ((e as ApiError).fatal || attempt >= 5) throw e
          await sleep(1000 * attempt)
        }
      }
      done += blob.size
      onProgress(done / file.size)
    }

    await api(`/api/upload/${id}/finish`, {
      method: "POST",
      json: {
        name: opts.name,
        rename: opts.rename,
        zip: opts.zip,
        zipPassword: opts.zipPassword,
        password: opts.password,
        expiresAt: opts.expiresAt,
      },
    })
  } catch (e) {
    fetch(`/api/upload/${id}`, { method: "DELETE" }).catch(() => {})
    throw e
  }
}

export { setUnauthorizedHandler }
