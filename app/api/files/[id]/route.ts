import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/server/auth"
import { deleteRecord, getDb, save } from "@/lib/server/db"
import { jsonError, readJson, type RouteCtx } from "@/lib/server/http"
import { cleanName, hashPw } from "@/lib/server/security"

export const dynamic = "force-dynamic"

interface PatchBody {
  name?: string
  expiresAt?: number | null
  removePassword?: boolean
  password?: string
}

export async function PATCH(req: Request, { params }: RouteCtx<"id">) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await params
  const r = getDb().files[id]
  if (!r) return jsonError("فایل پیدا نشد.", 404)

  const b = await readJson<PatchBody>(req)

  if (typeof b.name === "string" && b.name.trim()) {
    let n = cleanName(b.name, r.name)
    if (r.zipped && !/\.zip$/i.test(n)) n += ".zip"
    r.name = n
  }

  if ("expiresAt" in b) {
    if (b.expiresAt === null) {
      r.expiresAt = null
    } else {
      const t = Number(b.expiresAt)
      if (!Number.isFinite(t) || t <= Date.now()) {
        return jsonError("زمان انقضا نامعتبر است.", 400)
      }
      r.expiresAt = t
    }
  }

  if (b.removePassword) r.pw = null
  else if (typeof b.password === "string" && b.password) r.pw = hashPw(b.password)

  await save()
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: RouteCtx<"id">) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const { id } = await params
  const r = getDb().files[id]
  if (r) await deleteRecord(r)
  return NextResponse.json({ ok: true })
}
