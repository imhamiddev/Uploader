import path from "node:path"

/** 5 MB per request: safe for proxy / timeout limits on shared hosting. */
export const CHUNK_SIZE = 5 * 1024 * 1024

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const DOWNLOAD_TTL_MS = 10 * 60 * 1000

export interface ServerConfig {
  adminUser: string
  adminPass: string
  secret: string
  quota: number
  dataDir: string
  filesDir: string
  tmpDir: string
  dbFile: string
}

let cached: ServerConfig | null = null

/**
 * Configuration is resolved lazily (never at import time) so `next build`
 * works without the runtime environment variables being present.
 */
export function getConfig(): ServerConfig {
  if (cached) return cached

  const adminUser = process.env.ADMIN_USER
  const adminPass = process.env.ADMIN_PASS
  if (!adminUser || !adminPass) {
    throw new Error("ADMIN_USER and ADMIN_PASS environment variables are required.")
  }

  const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"))

  cached = {
    adminUser,
    adminPass,
    secret: process.env.SESSION_SECRET || "",
    quota: (parseFloat(process.env.QUOTA_GB ?? "") || 4.5) * 1024 ** 3,
    dataDir,
    filesDir: path.join(dataDir, "files"),
    tmpDir: path.join(dataDir, "tmp"),
    dbFile: path.join(dataDir, "db.json"),
  }
  return cached
}
