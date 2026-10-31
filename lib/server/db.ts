import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"

import { getConfig } from "./config"
import type { Database, FileRecord } from "./types"

interface DbState {
  db: Database
  saving: Promise<void>
  booted: boolean
}

/**
 * Next.js may evaluate server modules in more than one bundle, so the
 * in-memory database lives on globalThis to stay a true singleton.
 */
const g = globalThis as typeof globalThis & { __uploaderDb?: DbState }

function load(): DbState {
  const cfg = getConfig()
  fs.mkdirSync(cfg.filesDir, { recursive: true })
  fs.mkdirSync(cfg.tmpDir, { recursive: true })

  let db: Database = { files: {}, uploads: {} }
  try {
    db = Object.assign(db, JSON.parse(fs.readFileSync(cfg.dbFile, "utf8")))
  } catch {
    /* first run */
  }
  return { db, saving: Promise.resolve(), booted: false }
}

function state(): DbState {
  if (!g.__uploaderDb) g.__uploaderDb = load()
  return g.__uploaderDb
}

export function getDb(): Database {
  return state().db
}

/** Serialized, atomic (write + rename) persistence of the JSON database. */
export function save(): Promise<void> {
  const s = state()
  s.saving = s.saving
    .then(async () => {
      const cfg = getConfig()
      const tmp = cfg.dbFile + ".tmp"
      await fsp.writeFile(tmp, JSON.stringify(s.db))
      await fsp.rename(tmp, cfg.dbFile)
    })
    .catch((e) => console.error("db save failed", e))
  return s.saving
}

export async function unlinkQuiet(p: string): Promise<void> {
  try {
    await fsp.unlink(p)
  } catch {
    /* already gone */
  }
}

export async function deleteRecord(r: FileRecord): Promise<void> {
  const cfg = getConfig()
  if (r.file) await unlinkQuiet(path.join(cfg.filesDir, r.file))
  delete getDb().files[r.id]
  await save()
}

export function usedBytes(): number {
  const db = getDb()
  let n = 0
  for (const r of Object.values(db.files)) n += r.size || 0
  for (const u of Object.values(db.uploads)) n += u.size || 0
  return n
}

export function isExpired(r: FileRecord): boolean {
  return !!r.expiresAt && r.expiresAt <= Date.now()
}

/** Boot recovery: runs once per process. */
export function bootRecovery(): void {
  const s = state()
  if (s.booted) return
  s.booted = true

  const cfg = getConfig()
  for (const r of Object.values(s.db.files)) {
    if (r.status === "processing") {
      r.status = "failed"
      r.error = "Server restarted while processing"
    }
  }
  for (const f of fs.readdirSync(cfg.tmpDir)) {
    const id = f.replace(/\.part$/, "")
    if (!s.db.uploads[id]) void unlinkQuiet(path.join(cfg.tmpDir, f))
  }
  void save()
}
