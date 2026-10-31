import path from "node:path"

import { getConfig } from "./config"
import { bootRecovery, deleteRecord, getDb, isExpired, save, unlinkQuiet } from "./db"
import { pruneFails } from "./rate-limit"

const DAY = 24 * 3600 * 1000

/** Removes expired files and abandoned partial uploads. */
export async function cleanup(): Promise<void> {
  const db = getDb()
  const cfg = getConfig()

  for (const r of Object.values(db.files)) {
    if (isExpired(r) && r.status !== "processing") await deleteRecord(r)
  }
  for (const u of Object.values(db.uploads)) {
    if (Date.now() - u.last > DAY) {
      delete db.uploads[u.id]
      await unlinkQuiet(path.join(cfg.tmpDir, u.id + ".part"))
      void save()
    }
  }
  pruneFails()
}

const g = globalThis as typeof globalThis & { __uploaderTimer?: NodeJS.Timeout }

/** Starts the once-a-minute cleanup loop (idempotent). */
export function startCleanupLoop(): void {
  if (g.__uploaderTimer) return
  bootRecovery()
  g.__uploaderTimer = setInterval(() => {
    cleanup().catch(console.error)
  }, 60 * 1000)
  g.__uploaderTimer.unref()
  cleanup().catch(console.error)
}
