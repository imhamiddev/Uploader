import fsp from "node:fs/promises"
import path from "node:path"

import { getConfig } from "./config"
import { save, unlinkQuiet } from "./db"
import type { FileRecord } from "./types"
import { zipFile } from "./zip"

/**
 * Finalizes an uploaded temp file: either zips it or moves it into the
 * files directory. The admin UI polls `status` while this runs.
 */
export async function processUpload(
  rec: FileRecord,
  tmpPath: string,
  entryName: string,
  zipPassword: string
): Promise<void> {
  const cfg = getConfig()
  try {
    let dest: string
    if (rec.zipped) {
      rec.file = rec.id + ".zip"
      dest = path.join(cfg.filesDir, rec.file)
      await zipFile(tmpPath, dest, entryName, zipPassword || undefined)
      await unlinkQuiet(tmpPath)
    } else {
      rec.file = rec.id + ".bin"
      dest = path.join(cfg.filesDir, rec.file)
      await fsp.rename(tmpPath, dest)
    }
    rec.size = (await fsp.stat(dest)).size
    rec.status = "ready"
  } catch (e) {
    console.error("process failed", e)
    rec.status = "failed"
    rec.error = String((e as Error).message || e)
    await unlinkQuiet(tmpPath)
    if (rec.file) await unlinkQuiet(path.join(cfg.filesDir, rec.file))
  }
  await save()
}
