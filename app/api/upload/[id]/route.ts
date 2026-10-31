import path from "node:path"
import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { getConfig } from "@/lib/server/config"
import { getDb, save, unlinkQuiet } from "@/lib/server/db"
import type { RouteCtx } from "@/lib/server/http"

export const dynamic = "force-dynamic"

/** Aborts an in-progress upload and removes its partial file. */
export async function DELETE(req: Request, { params }: RouteCtx<"id">) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await params
  const db = getDb()
  const u = db.uploads[id]
  if (u) {
    delete db.uploads[u.id]
    await unlinkQuiet(path.join(getConfig().tmpDir, u.id + ".part"))
    void save()
  }
  return NextResponse.json({ ok: true })
}
