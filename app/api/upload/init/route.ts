import fsp from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { CHUNK_SIZE, getConfig } from "@/lib/server/config"
import { getDb, save, usedBytes } from "@/lib/server/db"
import { jsonError, readJson } from "@/lib/server/http"
import { cleanName, newId } from "@/lib/server/security"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const body = await readJson<{ size?: number; name?: string }>(req)
  const size = Number(body.size)
  if (!Number.isFinite(size) || size < 0) return jsonError("حجم نامعتبر", 400)
  if (usedBytes() + size > getConfig().quota) {
    return jsonError("فضای کافی نیست.", 413)
  }

  const id = newId()
  await fsp.writeFile(path.join(getConfig().tmpDir, id + ".part"), "")
  getDb().uploads[id] = {
    id,
    size,
    name: cleanName(body.name, "file"),
    last: Date.now(),
  }
  void save()
  return NextResponse.json({ id, chunkSize: CHUNK_SIZE })
}
