import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { getDb, save } from "@/lib/server/db"
import { jsonError, type RouteCtx } from "@/lib/server/http"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: RouteCtx<"id">) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await params
  const r = getDb().files[id]
  if (!r) return jsonError("فایل پیدا نشد.", 404)

  r.token = null
  r.revoked = true
  await save()
  return NextResponse.json({ ok: true })
}
