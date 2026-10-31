import fsp from "node:fs/promises"
import path from "node:path"
import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { CHUNK_SIZE, getConfig } from "@/lib/server/config"
import { getDb } from "@/lib/server/db"
import { jsonError, type RouteCtx } from "@/lib/server/http"

export const dynamic = "force-dynamic"

/** Receives one chunk and writes it at its offset in the partial file. */
export async function PUT(req: Request, { params }: RouteCtx<"id" | "index">) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id, index: rawIndex } = await params
  const u = getDb().uploads[id]
  const index = parseInt(rawIndex, 10)
  if (!u || !(index >= 0)) return jsonError("آپلود پیدا نشد.", 404)
  if (!req.body) return jsonError("bad body", 400)

  const offset = index * CHUNK_SIZE
  const limit = CHUNK_SIZE + 1024
  const fh = await fsp.open(path.join(getConfig().tmpDir, u.id + ".part"), "r+")
  const reader = req.body.getReader()

  try {
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      if (received > limit || offset + received > u.size) {
        await reader.cancel()
        return jsonError("خارج از محدوده حجم", 400)
      }
      await fh.write(value, 0, value.length, offset + received - value.length)
    }
  } finally {
    await fh.close()
  }

  u.last = Date.now()
  return NextResponse.json({ ok: true })
}
