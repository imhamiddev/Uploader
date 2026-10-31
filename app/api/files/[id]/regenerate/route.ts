import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { getDb, save } from "@/lib/server/db"
import { jsonError, type RouteCtx } from "@/lib/server/http"
import { newLinkToken } from "@/lib/server/security"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: RouteCtx<"id">) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await params
  const r = getDb().files[id]
  if (!r) return jsonError("فایل پیدا نشد.", 404)

  r.token = newLinkToken()
  r.revoked = false
  await save()
  return NextResponse.json({ ok: true, link: "/d/" + r.token })
}
